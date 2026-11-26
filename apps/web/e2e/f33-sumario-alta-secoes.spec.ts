// F3.3 (03-PEP L124): sumário de alta com seções configuráveis, pelo caminho da tela. O cadastro das seções e a
// finalização gravam e leem só o banco próprio, e o E2E roda com a fonte sintética (sem núcleo, as rotas respondem
// 503). Por isso as rotas da alta, das seções do atendimento e da finalização são simuladas pelo Playwright com massa
// SINTÉTICA; o cabeçalho do paciente vem da fonte sintética. O que se prova é a tela: o item do menu leva ao cadastro
// das seções; na aba da alta, as seções do estabelecimento aparecem com a obrigatória marcada e a janela de tempo, a
// seção de texto obrigatória pede preenchimento na hora, a recusa da API (sumário incompleto) aparece ao médico e a
// segunda finalização leva o texto da seção pelo código. O efeito no banco está nos contratos de efeito
// apps/api/src/modulos/pep/sumario-alta-secoes-propria.int.spec.ts e documentos-propria-operacoes.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { itemDoMenu, semViolacaoAxe } from './ajuda.js';

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

const ATENDIMENTO = {
  id: 8801,
  registro: 1001,
  tipo: 'internacao',
  entrada: '2026-11-20T10:00:00-03:00',
  alta: null,
  aberto: true,
  unidade: 'Clínica médica sintética',
};

const ALTA = {
  atendimento: ATENDIMENTO,
  atendimentos: [ATENDIMENTO],
  sumario: {
    diagnosticos: [{ cid: 'J18.9', descricao: 'Pneumonia sintética' }],
    procedimentos: ['Procedimento sintético'],
    medicamentosAlta: [],
    alergias: [],
    encaminhamentos: [],
  },
  versoes: [],
  finalizado: false,
  transferencias: [],
  obito: null,
  finalizar: { pode: true, motivo: null },
  obitoAcao: { pode: false, motivo: 'Simulado' },
  cancelarObitoAcao: { pode: false, motivo: 'Simulado' },
};

const secao = (codigo: string, descricao: string, tipoConteudo: string, ordem: number, extra = {}) => ({
  codigo,
  descricao,
  tipoConteudo,
  ordem,
  obrigatorio: false,
  periodo: null,
  origem: 'estabelecimento',
  janela: null,
  ...extra,
});

const SECOES = [
  secao('diagnosticos', 'Diagnósticos da alta', 'diagnosticos', 0, { obrigatorio: true }),
  secao('procedimentos_72h', 'Procedimentos das últimas 72 horas', 'procedimentos', 1, {
    periodo: 'ultimas_72_horas',
    janela: { desde: '2026-11-22T10:00:00-03:00', ate: '2026-11-25T10:00:00-03:00', ultimo: false },
  }),
  secao('plano', 'Plano terapêutico', 'plano_terapeutico', 2, { obrigatorio: true }),
  secao('orientacoes_alta', 'Orientações ao paciente', 'orientacoes', 3, { obrigatorio: true }),
  // Seção estruturada opcional: o campo da condição na alta só aparece quando o estabelecimento a configura.
  secao('condicao', 'Condição na alta', 'condicao_alta', 4),
];

test.describe('sumário de alta com seções configuráveis (03-PEP L124) @F33 @C1-041', () => {
  test('o item do menu leva ao cadastro das seções', async ({ page }) => {
    await page.route('**/api/pep/sumario-alta/secoes?*', (r) =>
      json(r, { itens: [], vigentes: SECOES.map((s) => ({ ...s, origem: 'padrao' })) }),
    );
    await page.route('**/api/pep/sumario-alta/periodos', (r) => json(r, { itens: [] }));
    await entrar(page, 'SINT.ADMIN');
    // PEP › Administração do PEP › Seções do sumário de alta.
    await (await itemDoMenu(page, 'Seções do sumário de alta')).click();
    await expect(page).toHaveURL(/\/pep\/sumario-alta\/secoes/);
    await expect(page.getByTestId('sumario-secoes')).toBeVisible();
    await semViolacaoAxe(page, '/pep/sumario-alta/secoes');
  });

  test('a alta mostra as seções do estabelecimento, barra na hora a seção obrigatória vazia, mostra a recusa do servidor e finaliza com o texto da seção', async ({
    page,
  }) => {
    const finalizacoes: Record<string, unknown>[] = [];
    await page.route('**/api/pep/paciente/*/alta*', (r) => json(r, ALTA));
    await page.route(`**/api/pep/sumario-alta/atendimento/${ATENDIMENTO.id}/secoes`, (r) =>
      json(r, { itens: SECOES }),
    );
    await page.route('**/api/pep/paciente/*/alta/finalizar', (r) => {
      const corpo = r.request().postDataJSON() as Record<string, unknown>;
      finalizacoes.push(corpo);
      // A primeira finalização (tela já preenchida) volta com a recusa do servidor; a segunda é aceita.
      if (finalizacoes.length === 1)
        return r.fulfill({
          status: 400,
          contentType: 'application/problem+json',
          body: JSON.stringify({
            type: 'urn:sgh:erro:entrada-invalida',
            title: 'Sumário incompleto',
            status: 400,
            detail: 'Informe ao menos um diagnóstico com CID.',
            codigo: 'sumario-incompleto',
            campos: ['diagnosticos'],
          }),
        });
      return json(r, { id: 9901, documento: 9902, versao: 1 }, 201);
    });

    await entrar(page, 'SINT.MEDICO');
    await page.goto('/pep/paciente/1001/alta');

    // As seções do estabelecimento: a obrigatória marcada e a janela de tempo da seção de procedimentos.
    const config = page.getByTestId('sumario-secoes-config');
    await expect(config).toContainText('Orientações ao paciente');
    await expect(page.getByTestId('sumario-secao-janela-procedimentos_72h')).toBeVisible();
    await expect(page.getByTestId('sumario-diagnosticos')).toHaveValue(/J18\.9 - Pneumonia sintética/);

    // A seção de texto obrigatória pede preenchimento na hora (antes de ir à API).
    const orientacoes = page.getByTestId('sumario-secao-texto-orientacoes_alta');
    await expect(orientacoes).toHaveAttribute('required', '');
    await page.getByTestId('sumario-finalizar').click();
    expect(finalizacoes).toHaveLength(0);

    // A seção estruturada obrigatória (plano terapêutico) também é barrada na hora: com o plano vazio, nada vai à API.
    const plano = page.getByTestId('sumario-plano');
    await expect(plano).toHaveAttribute('required', '');
    await expect(page.getByTestId('sumario-diagnosticos')).toHaveAttribute('required', '');
    await orientacoes.fill('Retorno ao ambulatório em 7 dias.');
    await page.getByTestId('sumario-condicao').fill('Estável');
    await page.getByTestId('sumario-finalizar').click();
    expect(await plano.evaluate((el) => (el as HTMLTextAreaElement).validity.valueMissing)).toBe(true);
    expect(finalizacoes).toHaveLength(0);

    // Com a tela preenchida, a recusa do servidor (sumário incompleto) aparece na tela.
    await plano.fill('Manter antibiótico por 5 dias.');
    await page.getByTestId('sumario-finalizar').click();
    await expect(page.getByTestId('mensagem-erro')).toBeVisible();
    expect(finalizacoes).toHaveLength(1);
    expect(finalizacoes[0]).toMatchObject({ sumario: { secoes: [{ codigo: 'orientacoes_alta' }] } });

    // A segunda finalização é aceita e leva o texto da seção pelo código.
    await page.getByTestId('sumario-finalizar').click();
    await expect.poll(() => finalizacoes.length).toBe(2);
    await expect(page.getByTestId('mensagem-erro')).toHaveCount(0);
    expect(finalizacoes[1]).toMatchObject({
      atendimento: ATENDIMENTO.id,
      sumario: {
        plano: 'Manter antibiótico por 5 dias.',
        condicaoAlta: 'Estável',
        secoes: [{ codigo: 'orientacoes_alta', texto: 'Retorno ao ambulatório em 7 dias.' }],
      },
    });
    await semViolacaoAxe(page, '/pep/paciente/1001/alta (seções)');
  });
});
