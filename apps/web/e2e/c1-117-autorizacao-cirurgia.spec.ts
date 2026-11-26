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
// tela. Na tela do agendamento confirmado, a entrada no bloco sem senha é recusada (rota de mudança de estado simulada
// com a recusa do servidor) e a causa aparece no texto da aplicação: autorizacao-pendente na eletiva,
// justificativa-urgencia na urgência sem a exceção, autorizacao-parcial na guia autorizada em parte, que pede a
// conferência registrada no painel. Massa SINTÉTICA.
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

function simular(
  page: Page,
  natureza: 'eletiva' | 'urgencia',
  opcoes: { parcial?: boolean; recusaAndamento?: string } = {},
) {
  const guias: Guia[] = opcoes.parcial
    ? [{ id: 950, numero: 'SA-FIC-9', situacao: 'autorizada_parcial', senha: 'PARC-FIC' }]
    : [];
  let conferencia: { justificativa: string; em: string } | null = null;
  const corpos: Record<string, unknown>[] = [];
  let versao = 3;
  let posterior: { justificativa: string; em: string } | null = null;
  const etapa = () => (opcoes.parcial ? 'autorizada_parcial' : guias.length ? 'guia_em_preparo' : 'sem_guia');
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
    senha: opcoes.parcial ? 'PARC-FIC' : null,
    etapa: etapa(),
    autorizacaoPosterior: posterior,
    conferenciaParcial: conferencia,
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
      await page.route(`**/api/tiss/autorizacoes/cirurgias/${AG}/parcial`, async (rota) => {
        const c = rota.request().postDataJSON() as { versao: number; justificativa: string };
        corpos.push(c);
        conferencia = { justificativa: c.justificativa, em: '2030-03-09 10:00' };
        versao += 1;
        return json(rota, { id: AG, etapa: etapa() });
      });
      const recusa = opcoes.recusaAndamento;
      if (recusa) {
        // O agendamento da fonte sintética aparece confirmado (a entrada no bloco fica oferecida).
        await page.route(`**/api/cirurgia/agendamentos/${AG}`, async (rota) => {
          if (rota.request().method() !== 'GET') return rota.fallback();
          const resposta = await rota.fetch();
          const corpo = (await resposta.json()) as { agendamento?: Record<string, unknown> };
          if (corpo.agendamento)
            corpo.agendamento = {
              ...corpo.agendamento,
              estado: 'confirmado',
              estadoRotulo: 'Confirmado',
              estadoId: corpo.agendamento['estadoId'] ?? AG,
            };
          await rota.fulfill({ response: resposta, json: corpo });
        });
        // A mudança de estado devolve a recusa do servidor enquanto a conferência (parcial) não for registrada.
        await page.route('**/api/cirurgia/estados/*/andamento', async (rota) => {
          corpos.push({ andamento: rota.request().postDataJSON() });
          if (opcoes.parcial && conferencia) return json(rota, { id: AG, estado: 'no-bloco' });
          return json(rota, { codigo: recusa, title: 'Recusada', status: 422 }, 422);
        });
      }
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

  test('agendamento confirmado: a entrada no bloco sem senha é recusada com a causa (eletiva e urgência sem exceção)', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const api = simular(page, 'eletiva', { recusaAndamento: 'autorizacao-pendente' });
    await api.ligar();
    await entrar(page, 'SINT.BLOCO');

    await page.goto(`/cirurgia/agendamentos/${AG}`);
    await expect(page.getByTestId('autorizacao-etapa')).toHaveAttribute('data-etapa', 'sem_guia');
    await page.getByRole('button', { name: 'Paciente no bloco' }).click();
    const recusa = page.getByTestId('recusa-cirurgia');
    await expect(recusa).toContainText('Cirurgia eletiva de convênio sem a senha da operadora');
    await expect(recusa).toContainText('Autorização da operadora');
    expect(api.corpos.at(-1)).toEqual({ andamento: { estado: 'no-bloco' } });
    await semViolacaoAxe(page, `/cirurgia/agendamentos/${AG}`);

    // Urgência sem a exceção registrada: a recusa pede a justificativa ou a exceção no painel.
    const urg = simular(page, 'urgencia', { recusaAndamento: 'justificativa-urgencia' });
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await urg.ligar();
    await page.goto(`/cirurgia/agendamentos/${AG}`);
    await expect(page.getByTestId('autorizacao-urgencia')).toBeVisible();
    await page.getByRole('button', { name: 'Paciente no bloco' }).click();
    await expect(page.getByTestId('recusa-cirurgia')).toContainText('pelo menos 10 letras');
    await expect(page.getByTestId('recusa-cirurgia')).toContainText('exceção de urgência');
    expect(externas).toEqual([]);
  });

  test('autorizada em parte: a etapa fica parcial, o bloco é recusado até a conferência registrada no painel', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const api = simular(page, 'eletiva', { parcial: true, recusaAndamento: 'autorizacao-parcial' });
    await api.ligar();
    await entrar(page, 'SINT.BLOCO');

    await page.goto(`/cirurgia/agendamentos/${AG}`);
    await expect(page.getByTestId('autorizacao-etapa')).toHaveAttribute('data-etapa', 'autorizada_parcial');
    await expect(page.getByTestId('autorizacao-parcial')).toContainText('autorizou só parte da guia');
    await page.getByRole('button', { name: 'Paciente no bloco' }).click();
    await expect(page.getByTestId('recusa-cirurgia')).toContainText(
      'registre a conferência da autorização parcial',
    );

    await page.getByTestId('autorizacao-conferir').click();
    const form = page.getByTestId('autorizacao-parcial-form');
    await expect(form).toBeVisible();
    // Validação na hora: a conferência curta deixa a gravação desligada.
    await form.getByLabel('O que segue autorizado e o que foi retirado ou complementado').fill('CURTA');
    await expect(page.getByTestId('autorizacao-gravar-conferencia')).toBeDisabled();
    await form
      .getByLabel('O que segue autorizado e o que foi retirado ou complementado')
      .fill('SEGUE SO O ITEM AUTORIZADO; COMPLEMENTO PEDIDO');
    await expect(page.getByTestId('autorizacao-gravar-conferencia')).toBeEnabled();
    await page.getByTestId('autorizacao-gravar-conferencia').click();
    await expect(page.getByTestId('autorizacao-mensagem')).toContainText('Conferência registrada');
    expect(api.corpos.at(-1)).toEqual({
      versao: 3,
      justificativa: 'SEGUE SO O ITEM AUTORIZADO; COMPLEMENTO PEDIDO',
    });
    await expect(page.getByTestId('autorizacao-parcial-conferida')).toContainText(
      'Autorização parcial conferida',
    );
    await expect(page.getByTestId('autorizacao-conferir')).toHaveCount(0);

    // Com a conferência, a entrada no bloco passa.
    await page.getByRole('button', { name: 'Paciente no bloco' }).click();
    await expect(page.getByTestId('recusa-cirurgia')).toHaveCount(0);
    await semViolacaoAxe(page, `/cirurgia/agendamentos/${AG}`);
    expect(externas).toEqual([]);
  });
});
