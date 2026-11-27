// E2E @C1-030 (F7, 04-HOT linha 133): refeição do acompanhante pelo direito, pelo caminho da tela
// (`/nutricao/refeicao-acompanhante`). A copa (SINT.COPA: hotelaria.mapaDieta.ler e .fechar e o registro da dieta do
// acompanhante) vê as regras do direito, cria a regra do convênio (a validação do domínio recusa na hora a regra de
// convênio sem fonte pagadora), tira a regra de uso e, por internação (?reg=), consulta a decisão antes de lançar,
// lança a refeição que a fonte pagadora precisa autorizar, registra a autorização e cancela com motivo a refeição que
// não está na conta. Os combos são SanteSelecao. As respostas são simuladas pelo Playwright com massa SINTÉTICA, no
// contrato do servidor; o que fica no banco está no contrato de efeito
// (apps/api/src/modulos/nutricao/direito-refeicao-propria.int.spec.ts).
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher, esperarSemSelectNativo } from './combos.js';

const SENHA = 'Sintetico#2026';
const HOJE = new Intl.DateTimeFormat('en-CA').format(new Date());

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

const APOIO = {
  fontes: [{ id: 12, descricao: 'Convênio Sintético' }],
  acomodacoes: [{ id: 3, descricao: 'Apartamento' }],
  refeicoes: [
    { id: 1, descricao: 'Desjejum' },
    { id: 2, descricao: 'Almoço' },
  ],
};
const regraLei = {
  id: 1,
  descricao: 'Acompanhante de idoso (60 anos ou mais)',
  fundamento: 'lei',
  fontePagadora: null,
  fontePagadoraNome: null,
  acomodacao: null,
  acomodacaoDescricao: null,
  idadeMinima: 60,
  idadeMaxima: null,
  cobertoPelaFonte: true,
  exigeAutorizacao: false,
  incluidoNaDiaria: false,
  vigenciaInicio: '2026-01-01',
  vigenciaFim: null,
  ativo: true,
  refeicoes: [],
  versao: 1,
};

function simular(page: Page) {
  const estado = {
    regras: [regraLei] as Record<string, unknown>[],
    lancadas: [] as Record<string, unknown>[],
    regraGravada: null as unknown,
    uso: null as unknown,
    lancamento: null as unknown,
    autorizacao: null as unknown,
    cancelamento: null as unknown,
  };
  void page.route(/\/api\/nutricao\/direito-refeicao\/apoio$/, (r) => json(r, APOIO));
  void page.route(/\/api\/nutricao\/direito-refeicao\/\d+\/uso$/, (r) => {
    estado.uso = r.request().postDataJSON();
    estado.regras = estado.regras.map((x) => (x['id'] === 2 ? { ...x, ativo: false, versao: 2 } : x));
    return json(r, { id: 2 });
  });
  void page.route(/\/api\/nutricao\/direito-refeicao$/, (r) => {
    if (r.request().method() === 'POST') {
      const corpo = r.request().postDataJSON() as Record<string, unknown>;
      estado.regraGravada = corpo;
      estado.regras = [
        ...estado.regras,
        {
          ...corpo,
          id: 2,
          fontePagadoraNome: 'Convênio Sintético',
          acomodacaoDescricao: null,
          ativo: true,
          versao: 1,
        },
      ];
      return json(r, { id: 2 });
    }
    return json(r, { itens: estado.regras });
  });
  void page.route(/\/api\/nutricao\/refeicoes-acompanhante\/501\/decisao\?/, (r) =>
    json(r, {
      cobertura: 'a_autorizar',
      regra: 2,
      fundamento: 'convenio',
      incluidaNaDiaria: false,
      motivo: 'Regra do convênio com autorização da fonte pagadora.',
      regraDescricao: 'Convênio Sintético: almoço do acompanhante',
      idadePaciente: 45,
      baseLegal: null,
    }),
  );
  void page.route(/\/api\/nutricao\/refeicoes-acompanhante\/501$/, (r) =>
    json(r, { itens: estado.lancadas }),
  );
  void page.route(/\/api\/nutricao\/refeicoes-acompanhante\/\d+\/autorizacao$/, (r) => {
    estado.autorizacao = r.request().postDataJSON();
    estado.lancadas = estado.lancadas.map((x) =>
      x['id'] === 900 ? { ...x, situacao: 'autorizada', autorizadaPelaFonte: true, versao: 2 } : x,
    );
    return json(r, { id: 900, cobertura: 'coberta', valor: null });
  });
  void page.route(/\/api\/nutricao\/refeicoes-acompanhante\/\d+\/cancelar$/, (r) => {
    estado.cancelamento = r.request().postDataJSON();
    estado.lancadas = estado.lancadas.map((x) =>
      x['id'] === 900 ? { ...x, situacao: 'cancelada', versao: 3 } : x,
    );
    return json(r, { id: 900 });
  });
  void page.route(/\/api\/nutricao\/refeicoes-acompanhante$/, (r) => {
    estado.lancamento = r.request().postDataJSON();
    estado.lancadas = [
      {
        id: 900,
        data: HOJE,
        refeicao: 2,
        refeicaoDescricao: 'Almoço',
        quantidade: 1,
        situacao: 'solicitada',
        cobravel: false,
        valor: null,
        regra: 2,
        regraDescricao: 'Convênio Sintético: almoço do acompanhante',
        autorizadaPelaFonte: false,
        conta: null,
        observacao: null,
        versao: 1,
      },
    ];
    return json(r, { id: 900, cobertura: 'a_autorizar', valor: null });
  });
  return estado;
}

test.describe('@C1-030 refeição do acompanhante pelo direito', () => {
  test.setTimeout(120_000);
  test('regras (validação na hora, gravação, tirar de uso) → decisão → lançar → autorizar → cancelar; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const estado = simular(page);
    await entrar(page, 'SINT.COPA');
    await page.goto('/nutricao/refeicao-acompanhante?aba=regras');
    await expect(page.getByTestId('tela-refeicao-acompanhante')).toBeVisible();
    await expect(page.getByTestId('regra-1')).toContainText('Acompanhante de idoso');
    await expect(page.getByTestId('regra-1')).toContainText('Lei');

    await page.getByTestId('nova-regra').click();
    await esperarSemSelectNativo(page.getByTestId('form-regra'));
    await page
      .getByTestId('regra-descricao')
      .locator('input')
      .fill('Convênio Sintético: almoço do acompanhante');
    await escolher(page.getByTestId('regra-fundamento'), { rotulo: 'Convênio' });
    await page.getByTestId('regra-coberto').check();
    await page.getByTestId('regra-autorizacao').check();
    await expect(page.getByTestId('regra-problemas')).toContainText('precisa da fonte pagadora');
    await expect(page.getByTestId('salvar-regra')).toBeDisabled();
    await escolher(page.getByTestId('regra-fonte'), { rotulo: 'Convênio Sintético' });
    await page.getByTestId('regra-refeicao-2').check();
    await expect(page.getByTestId('regra-problemas')).toHaveCount(0);
    await semViolacaoAxe(page, '/nutricao/refeicao-acompanhante (regras)');
    await page.getByTestId('salvar-regra').click();
    await expect(page.getByTestId('direito-mensagem')).toContainText('Regra gravada');
    expect(estado.regraGravada).toMatchObject({
      fundamento: 'convenio',
      fontePagadora: 12,
      acomodacao: null,
      cobertoPelaFonte: true,
      exigeAutorizacao: true,
      incluidoNaDiaria: false,
      refeicoes: [2],
    });
    await expect(page.getByTestId('regra-2')).toContainText('Convênio Sintético');
    await page.getByTestId('uso-regra-2').click();
    await expect(page.getByTestId('regra-2')).toContainText('Fora de uso');
    expect(estado.uso).toEqual({ ativo: false, versao: 1 });

    await page.goto('/nutricao/refeicao-acompanhante?reg=501');
    await expect(page.getByTestId('form-lancamento')).toBeVisible();
    await escolher(page.getByTestId('lanc-refeicao'), { rotulo: 'Almoço' });
    await page.getByTestId('consultar-decisao').click();
    await expect(page.getByTestId('decisao-cobertura')).toHaveText('A autorizar pela fonte pagadora');
    await expect(page.getByTestId('decisao-refeicao')).toContainText('45 anos');
    await page.getByTestId('lancar-refeicao').click();
    await expect(page.getByTestId('direito-mensagem')).toContainText('Refeição lançada');
    expect(estado.lancamento).toEqual({
      internacao: 501,
      data: HOJE,
      refeicao: 2,
      quantidade: 1,
      observacao: null,
    });
    await expect(page.getByTestId('lancada-900')).toContainText('À espera da autorização');
    await semViolacaoAxe(page, '/nutricao/refeicao-acompanhante (por internação)');

    await page.getByTestId('autorizar-900').click();
    await expect(page.getByTestId('lancada-900')).toContainText('Decidida');
    expect(estado.autorizacao).toEqual({ autorizada: true, versao: 1 });

    await page.getByTestId('cancelar-900').click();
    await page.getByTestId('motivo-900').locator('input').fill('Acompanhante não ficou para o almoço');
    await page.getByTestId('confirmar-cancelar-900').click();
    await expect(page.getByTestId('lancada-900')).toContainText('Cancelada');
    expect(estado.cancelamento).toEqual({ motivo: 'Acompanhante não ficou para o almoço', versao: 2 });
    expect(externas).toEqual([]);
  });
});
