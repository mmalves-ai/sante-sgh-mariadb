// F8 (06-FAT linha 19) @C2-043: desconto por volume e franquia do contrato pelo caminho da tela. As rotas exigem o
// banco próprio e o E2E roda com a fonte sintética, então as respostas da API são simuladas pelo Playwright com massa
// SINTÉTICA. O que se prova é a tela: a faixa sobreposta trava o salvar enquanto se digita, a franquia sem vínculo
// nenhum é recusada na hora, e o painel da conta (aberto pelo atalho da conta) mostra a prévia com o motivo, a simulação
// do vínculo e a aplicação com o total cobrado do convênio e a parte do paciente. O efeito no banco está no contrato de
// efeito apps/api/src/modulos/faturamento/regras-comerciais-propria.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const CONTA = 7843;

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

const REGRAS = {
  regrasConta: [],
  descontos: [],
  franquias: [],
  ambulancia: [],
  ligacao: [],
  opcoes: {
    fontes: [{ id: 3, descricao: 'CONVENIO SINTETICO' }],
    contratos: [{ id: 4, descricao: 'CT-SINT CONTRATO SINTETICO' }],
    origensEntrada: [],
    categoriasAtendimento: [],
    setores: [],
    grupos: [{ id: 6, descricao: 'GRUPO SINTETICO' }],
    categoriasAmbulancia: [],
    rotas: [],
    tiposLigacao: [],
  },
};

function comercial(aplicado: boolean, simulacao: string | null) {
  return {
    conta: {
      id: CONTA,
      numero: 'C-7843',
      situacao: 'aberta',
      atendimentoId: 70,
      valorItens: 1000,
      valorAcrescimo: 0,
      valorDesconto: aplicado ? 300 : 0,
      valorPaciente: aplicado ? 200 : 0,
      valorTotal: aplicado ? 700 : 1000,
    },
    previa: {
      franquia: [
        {
          id: 11,
          descricao: 'FRANQUIA SINTETICA',
          motivo: simulacao === 'pensionista' ? 'vinculo_nao_coberto' : null,
          valor: simulacao === 'pensionista' ? 0 : 200,
          base: 1000,
        },
      ],
      desconto: {
        regraId: 21,
        descricao: 'DESCONTO SINTETICO',
        medida: 'valor_competencia',
        volume: 1000,
        valor: 100,
      },
      situacao: {
        vinculo: simulacao ?? 'titular',
        origemVinculo: simulacao ? 'simulacao' : 'cadastro',
        coberturaPacienteId: 90,
      },
    },
    aplicados: aplicado
      ? [
          { id: 1, sequencia: 1, tipo: 'franquia', valor: 200, observacao: null, vigente: true },
          { id: 2, sequencia: 2, tipo: 'desconto_volume', valor: 100, observacao: null, vigente: true },
        ]
      : [],
    ligacoes: [],
  };
}

async function simular(page: Page, enviados: Record<string, unknown>[]): Promise<void> {
  let aplicado = false;
  await page.route('**/api/faturamento/regras-comerciais', (r) => json(r, REGRAS));
  await page.route('**/api/faturamento/regras-comerciais/descontos-volume', (r) => {
    enviados.push({ rota: 'desconto', ...(r.request().postDataJSON() as Record<string, unknown>) });
    return json(r, { id: 21, faixas: 2 });
  });
  await page.route('**/api/faturamento/regras-comerciais/franquias', (r) => {
    enviados.push({ rota: 'franquia', ...(r.request().postDataJSON() as Record<string, unknown>) });
    return json(r, { id: 11 });
  });
  await page.route(`**/api/faturamento/contas/${CONTA}/comercial**`, (r) => {
    const v = new URL(r.request().url()).searchParams.get('vinculo');
    return json(r, comercial(aplicado, v));
  });
  await page.route(`**/api/faturamento/contas/${CONTA}/franquia-desconto`, (r) => {
    enviados.push({ rota: 'aplicar', ...(r.request().postDataJSON() as Record<string, unknown>) });
    aplicado = true;
    return json(r, {
      contaId: CONTA,
      franquia: 200,
      desconto: 100,
      substituidas: 0,
      valorTotal: 700,
      valorPaciente: 200,
    });
  });
}

test.describe('@C2-043 descontos por volume e franquias (06-FAT linha 19)', () => {
  test('faixas e franquia conferidas na hora e aplicação na conta com o total do convênio', async ({
    page,
  }) => {
    const enviados: Record<string, unknown>[] = [];
    await simular(page, enviados);
    await entrar(page, 'SINT.TISS');

    // Desconto por volume: a faixa sobreposta trava o salvar.
    await page.goto('/faturamento/descontos-franquias');
    await expect(page.getByTestId('tela-descontos-franquias')).toBeVisible();
    await expect(page.getByTestId('df-sem-descontos')).toBeVisible();
    await escolher(page.getByTestId('df-desconto-convenio'), { rotulo: 'CONVENIO SINTETICO' });
    await page.getByTestId('df-desconto-descricao').fill('DESCONTO SINTETICO');
    await page.getByTestId('df-faixa-0-ate').fill('600');
    await page.getByTestId('df-nova-faixa').click();
    await page.getByTestId('df-faixa-1-de').fill('500');
    await page.getByTestId('df-faixa-1-percentual').fill('10');
    await expect(page.getByTestId('df-desconto-erros')).toBeVisible();
    await expect(page.getByTestId('df-desconto-salvar')).toBeDisabled();
    await page.getByTestId('df-faixa-1-de').fill('600');
    await expect(page.getByTestId('df-desconto-erros')).toBeHidden();
    await page.getByTestId('df-desconto-salvar').click();
    await expect(page.getByTestId('df-mensagem')).toBeVisible();
    expect(enviados.find((e) => e['rota'] === 'desconto')).toMatchObject({
      fontePagadoraId: 3,
      faixas: [
        { sequencia: 1, volumeInicial: 0, volumeFinal: 600 },
        { sequencia: 2, volumeInicial: 600, volumeFinal: null, percentual: 10 },
      ],
    });

    // Franquia: sem vínculo nenhum marcado, o salvar trava.
    await page.getByTestId('df-aba-franquia').click();
    await escolher(page.getByTestId('df-franquia-contrato'), { rotulo: /CONTRATO SINTETICO/ });
    await page.getByTestId('df-franquia-descricao').fill('FRANQUIA SINTETICA');
    await page.getByTestId('df-franquia-valor').fill('200');
    await page.getByTestId('df-franquia-titular').uncheck();
    await page.getByTestId('df-franquia-dependente').uncheck();
    await page.getByTestId('df-franquia-pensionista').uncheck();
    await expect(page.getByTestId('df-franquia-salvar')).toBeDisabled();
    await page.getByTestId('df-franquia-titular').check();
    await page.getByTestId('df-franquia-salvar').click();
    await expect(page.getByTestId('df-mensagem')).toBeVisible();
    expect(enviados.find((e) => e['rota'] === 'franquia')).toMatchObject({
      contratoId: 4,
      tipo: 'valor',
      valorFranquia: 200,
      aplicaTitular: true,
      aplicaPensionista: false,
    });

    // Na conta: prévia pelo vínculo do cadastro, simulação só na leitura, aplicação com o total do convênio.
    await page.goto(`/faturamento/descontos-franquias?conta=${CONTA}`);
    await expect(page.getByTestId('df-conta-cabecalho')).toContainText('C-7843');
    await expect(page.getByTestId('df-conta-vinculo')).toContainText('carteira do cadastro');
    await expect(page.getByTestId('df-conta-franquia-11')).toContainText('R$');
    await escolher(page.getByTestId('df-conta-simulacao'), { rotulo: 'Pensionista' });
    await expect(page.getByTestId('df-conta-franquia-11')).toContainText('vínculo não coberto');
    await escolher(page.getByTestId('df-conta-simulacao'), { rotulo: 'O da carteira do cadastro' });
    await expect(page.getByTestId('df-conta-total')).toContainText('1.000,00');
    await page.getByTestId('df-conta-aplicar').click();
    await expect(page.getByTestId('df-mensagem')).toContainText('700,00');
    await expect(page.getByTestId('df-conta-total')).toContainText('700,00');
    await expect(page.getByTestId('df-conta-paciente')).toContainText('200,00');
    await expect(page.getByTestId('df-conta-aplicados')).toContainText('Desconto por volume');
    // A requisição de aplicação não leva o vínculo (a gravação usa o da carteira do cadastro).
    expect(Object.keys(enviados.find((e) => e['rota'] === 'aplicar') ?? {})).toEqual(['rota']);
    await semViolacaoAxe(page, 'descontos e franquias');
  });
});
