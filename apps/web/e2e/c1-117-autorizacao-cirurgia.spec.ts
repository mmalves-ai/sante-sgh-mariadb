// E2E @C1-117 (F7, 04-CC linha 102): autorização prévia da cirurgia eletiva junto à operadora, por etapas, no
// agendamento cirúrgico. As rotas `/api/tiss/autorizacoes/...` só existem no banco do cliente (na fonte sintética
// respondem 503), então este E2E simula essas rotas com um estado em memória que segue a regra do servidor: a etapa
// sai da situação da guia ligada à cirurgia; a guia nasce ligada ao agendamento, com o cirurgião como solicitante; a
// exceção sem senha vale só para urgência, com justificativa, e a guia é comunicada depois. As permissões da
// autorização (faturamento.autorizacao.ler/solicitar) são somadas às da sessão do bloco, como faria a concessão do
// perfil. O agendamento 701 e o resto da tela vêm da fonte sintética de dev. O que fica no banco está nos contratos de
// efeito apps/api/src/modulos/tiss/autorizacao-cirurgia-propria.int.spec.ts e
// apps/api/src/modulos/cirurgia/porta-propria.int.spec.ts (a eletiva de convênio sem senha não é confirmada). Aqui se
// prova o fluxo: a etapa aparece, a carteira principal já vem marcada, o código TUSS é conferido na hora, um clique
// grava o pedido ligado à cirurgia e a etapa muda; na urgência, a exceção é registrada e aparece no painel. Axe na
// tela. Massa SINTÉTICA.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const AG = 701;
const PACIENTE = 5101;
const CIRURGIAO = 5001;

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

const COBERTURAS = [
  { id: 31, fontePagadora: 'OPERADORA FICTICIA A', carteira: '0000-FIC-1', validade: '2031-12-31' },
  { id: 32, fontePagadora: 'OPERADORA FICTICIA B', carteira: '0000-FIC-2', validade: null },
];

interface Guia {
  id: number;
  numero: string;
  situacao: string;
  senha: string | null;
}

function simular(page: Page, natureza: 'eletiva' | 'urgencia') {
  const guias: Guia[] = [];
  const corpos: Record<string, unknown>[] = [];
  let versao = 3;
  let posterior: { justificativa: string; em: string } | null = null;
  const etapa = () => (guias.length ? 'guia_em_preparo' : 'sem_guia');
  const leitura = () => ({
    id: AG,
    numero: 'CC-FIC-1',
    situacao: 'agendado',
    carater: 'eletivo',
    natureza,
    inicioPrevisto: '2030-03-10 08:00',
    versao,
    paciente: PACIENTE,
    cirurgiao: CIRURGIAO,
    senha: null,
    etapa: etapa(),
    autorizacaoPosterior: posterior,
    guias,
  });
  return {
    corpos,
    async ligar() {
      await page.route('**/api/sessao', async (rota) => {
        const resposta = await rota.fetch();
        const corpo = (await resposta.json()) as { permissoes?: string[] };
        if (Array.isArray(corpo.permissoes))
          corpo.permissoes = [
            ...corpo.permissoes,
            'faturamento.autorizacao.ler',
            'faturamento.autorizacao.solicitar',
          ];
        await rota.fulfill({ response: resposta, json: corpo });
      });
      await page.route(`**/api/tiss/autorizacoes/cirurgias/${AG}`, (rota) => json(rota, leitura()));
      await page.route(`**/api/tiss/autorizacoes/pacientes/${PACIENTE}`, (rota) =>
        json(rota, { paciente: PACIENTE, coberturas: COBERTURAS }),
      );
      await page.route('**/api/tiss/autorizacoes', async (rota) => {
        if (rota.request().method() !== 'POST') return rota.fallback();
        const c = rota.request().postDataJSON() as Record<string, unknown>;
        corpos.push(c);
        const g = {
          id: 900 + guias.length,
          numero: `SA-FIC-${guias.length + 1}`,
          situacao: 'em_preparo',
          senha: null,
        };
        guias.push(g);
        versao += 1;
        return json(rota, { id: g.id, numero: g.numero }, 201);
      });
      await page.route(`**/api/tiss/autorizacoes/cirurgias/${AG}/urgencia`, async (rota) => {
        const c = rota.request().postDataJSON() as { versao: number; justificativa: string };
        corpos.push(c);
        posterior = { justificativa: c.justificativa, em: '2030-03-10 07:40' };
        versao += 1;
        return json(rota, { id: AG, etapa: etapa() });
      });
    },
  };
}

test.describe('Autorização prévia da cirurgia eletiva por etapas @C1-117', () => {
  test('eletiva de convênio: etapa sem guia, carteira marcada, TUSS conferido na hora, pedido ligado à cirurgia; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const api = simular(page, 'eletiva');
    await api.ligar();
    await entrar(page, 'SINT.BLOCO');

    await page.goto(`/cirurgia/agendamentos/${AG}`);
    const painel = page.getByTestId('autorizacao-cirurgia');
    await expect(painel).toBeVisible();
    await expect(page.getByTestId('autorizacao-etapa')).toHaveAttribute('data-etapa', 'sem_guia');
    await expect(painel).toContainText('Sem senha');
    // Eletiva: a exceção de urgência não é oferecida.
    await expect(page.getByTestId('autorizacao-urgencia')).toHaveCount(0);

    await page.getByTestId('autorizacao-pedir').click();
    const form = page.getByTestId('autorizacao-form');
    await expect(form).toBeVisible();
    await expect(form.getByRole('combobox', { name: 'Carteira do paciente' })).toContainText(
      'OPERADORA FICTICIA A',
    );
    await escolher(form.getByRole('combobox', { name: 'Carteira do paciente' }), '32');

    // Validação na hora: o código TUSS tem 8 dígitos.
    await page.getByTestId('autorizacao-codigo').fill('3090101');
    await form.getByLabel('Procedimento', { exact: true }).fill('PROCEDIMENTO FICTICIO');
    await expect(form).toContainText('O código TUSS tem 8 dígitos.');
    await expect(page.getByTestId('autorizacao-gravar')).toBeDisabled();
    await page.getByTestId('autorizacao-codigo').fill('30901018');
    await expect(form).not.toContainText('O código TUSS tem 8 dígitos.');
    await form.getByLabel('Indicação clínica').fill('INDICACAO FICTICIA');
    await expect(page.getByTestId('autorizacao-gravar')).toBeEnabled();

    await page.getByTestId('autorizacao-gravar').click();
    await expect(page.getByTestId('autorizacao-mensagem')).toContainText(
      'Guia SA-FIC-1 gravada e ligada à cirurgia.',
    );
    expect(api.corpos[0]).toMatchObject({
      tipo: 'sp_sadt',
      cobertura: 32,
      agendamentoCirurgico: AG,
      solicitanteProfissional: CIRURGIAO,
      canal: 'portal',
      indicacaoClinica: 'INDICACAO FICTICIA',
      itens: [
        {
          codigoTabela: '22',
          codigoProcedimento: '30901018',
          descricao: 'PROCEDIMENTO FICTICIO',
          quantidade: 1,
        },
      ],
    });
    await expect(page.getByTestId('autorizacao-etapa')).toHaveAttribute('data-etapa', 'guia_em_preparo');
    await expect(page.getByTestId('autorizacao-guias')).toContainText('SA-FIC-1');
    // Com guia aberta, não se pede outra.
    await expect(page.getByTestId('autorizacao-pedir')).toHaveCount(0);
    await semViolacaoAxe(page, `/cirurgia/agendamentos/${AG}`);
    expect(externas).toEqual([]);
  });

  test('urgência sem senha: a exceção exige justificativa, fica registrada e a guia é comunicada depois', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const api = simular(page, 'urgencia');
    await api.ligar();
    await entrar(page, 'SINT.BLOCO');

    await page.goto(`/cirurgia/agendamentos/${AG}`);
    await expect(page.getByTestId('autorizacao-etapa')).toHaveAttribute('data-etapa', 'sem_guia');
    await page.getByTestId('autorizacao-urgencia').click();
    const form = page.getByTestId('autorizacao-urgencia-form');
    await expect(form).toBeVisible();
    // Sem justificativa, o registro fica desligado.
    await expect(page.getByTestId('autorizacao-registrar-urgencia')).toBeDisabled();
    await form.getByLabel('Justificativa da urgência').fill('ABDOME AGUDO FICTICIO, SEM TEMPO PARA A SENHA');
    await expect(page.getByTestId('autorizacao-registrar-urgencia')).toBeEnabled();
    await page.getByTestId('autorizacao-registrar-urgencia').click();

    await expect(page.getByTestId('autorizacao-mensagem')).toContainText('Exceção registrada');
    expect(api.corpos.at(-1)).toEqual({
      versao: 3,
      justificativa: 'ABDOME AGUDO FICTICIO, SEM TEMPO PARA A SENHA',
    });
    await expect(page.getByTestId('autorizacao-posterior')).toContainText('Urgência sem senha');
    await expect(page.getByTestId('autorizacao-urgencia')).toHaveCount(0);
    // A guia continua a ser pedida depois (comunicação posterior).
    await expect(page.getByTestId('autorizacao-pedir')).toBeVisible();
    await semViolacaoAxe(page, `/cirurgia/agendamentos/${AG}`);
    expect(externas).toEqual([]);
  });
});
