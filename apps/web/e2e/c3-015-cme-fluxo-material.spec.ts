// F7 (04-CME linha 117) @C3-015: solicitação, entrega ao setor e recolhimento do material esterilizado, com a
// conferência do setor e as permissões da CME por setor, pelo caminho da tela. As rotas exigem o banco próprio e o E2E
// roda com a fonte sintética, então as respostas da API são simuladas pelo Playwright com massa SINTÉTICA e um estado
// que avança a cada gravação. O que se prova é a tela: a CME recebe a solicitação aberta; o cancelamento trava sem o
// motivo; a entrega trava sem solicitação, setores e pacotes e envia os pacotes escolhidos; o recolhimento envia a
// integridade de cada pacote; o setor confere o movimento; a permissão por setor usa a busca remota do colaborador. O
// efeito no banco está no contrato de efeito apps/api/src/modulos/cirurgia/cme-movimento-propria.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

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

const marcas = (sim: string[]) =>
  Object.fromEntries(
    [
      'expurgo',
      'lavagem',
      'desinfeccao',
      'preparo',
      'esterilizacao',
      'entradaArsenal',
      'saidaArsenal',
      'devolucaoArsenal',
      'transferenciaArsenal',
      'terceirizacao',
    ].map((m) => [m, sim.includes(m)]),
  );

interface Estado {
  solicitacao: 'aberta' | 'recebida_cme' | 'entregue';
  pacote: 'esteril' | 'distribuido';
  movimento: 'aberto' | 'conferido' | null;
  recolhido: boolean;
  permissao: boolean;
  corpos: Record<string, unknown>;
}

function painel(e: Estado) {
  const pacote = {
    id: 61,
    etiqueta: 'CME-0001-000061',
    caixa: 'CAIXA SINTETICA',
    situacao: e.pacote,
    validade: '2099-12-31',
    setor: e.pacote === 'distribuido' ? 12 : null,
  };
  return {
    solicitacoes:
      e.solicitacao === 'entregue'
        ? []
        : [
            {
              id: 41,
              numero: 'SME-000041',
              tipo: 'setor',
              situacao: e.solicitacao,
              urgente: true,
              setor: 'UNIDADE SINTETICA',
              solicitadoEm: '2026-11-26T08:00:00',
              necessarioAte: null,
              versao: 1,
              itens: [{ id: 51, caixa: 'CAIXA SINTETICA', quantidade: 1, atendida: 0, situacao: 'pendente' }],
            },
          ],
    arsenal: e.pacote === 'esteril' ? [pacote] : [],
    foraDaCme: e.pacote === 'distribuido' ? [pacote] : [],
    movimentos: e.movimento
      ? [
          {
            id: 81,
            numero: 1,
            tipo: 'entrega',
            situacao: e.movimento,
            setor: 'SETOR SINTETICO UTI',
            ocorridoEm: '2026-11-26T09:00:00',
            itens: 1,
            versao: 1,
          },
        ]
      : [],
    permissoes: e.permissao
      ? [
          {
            id: 91,
            usuario: 7,
            usuarioNome: 'COLABORADOR SINTETICO',
            setor: 12,
            setorNome: 'SETOR SINTETICO UTI',
            ...marcas(['expurgo', 'saidaArsenal']),
          },
        ]
      : [],
    setores: [
      { id: 11, nome: 'SETOR SINTETICO CME' },
      { id: 12, nome: 'SETOR SINTETICO UTI' },
    ],
  };
}

async function simular(page: Page, e: Estado): Promise<void> {
  const corpo = (r: Route, nome: string) => {
    e.corpos[nome] = r.request().postDataJSON();
  };
  await page.route('**/api/cirurgia/cme/fluxo', (r) => json(r, painel(e)));
  await page.route('**/api/cirurgia/cme/fluxo/solicitacoes/41/receber', (r) => {
    e.solicitacao = 'recebida_cme';
    return json(r, { solicitacao: 41, situacao: 'recebida_cme' });
  });
  await page.route('**/api/cirurgia/cme/fluxo/entregas', (r) => {
    corpo(r, 'entrega');
    e.solicitacao = 'entregue';
    e.pacote = 'distribuido';
    e.movimento = 'aberto';
    return json(r, { movimento: 81, solicitacao: 'entregue' }, 201);
  });
  await page.route('**/api/cirurgia/cme/fluxo/movimentos/81/conferir', (r) => {
    e.movimento = 'conferido';
    return json(r, { movimento: 81, situacao: 'conferido' });
  });
  await page.route('**/api/cirurgia/cme/fluxo/recolhimentos', (r) => {
    corpo(r, 'recolhimento');
    e.recolhido = true;
    return json(r, { movimento: 82, arsenal: 1, expurgo: 0 }, 201);
  });
  await page.route(/\/api\/cirurgia\/cme\/fluxo\/usuarios\?/, (r) =>
    json(r, { itens: [{ id: 7, nome: 'COLABORADOR SINTETICO (sint.colab)' }] }),
  );
  await page.route('**/api/cirurgia/cme/fluxo/permissoes', (r) => {
    corpo(r, 'permissao');
    e.permissao = true;
    return json(r, { permissao: 91 });
  });
}

test.describe('@C3-015 solicitação, entrega e recolhimento do material esterilizado (04-CME linha 117)', () => {
  test('recebe, entrega ao setor, confere, recolhe e grava a permissão por setor', async ({ page }) => {
    const e: Estado = {
      solicitacao: 'aberta',
      pacote: 'esteril',
      movimento: null,
      recolhido: false,
      permissao: false,
      corpos: {},
    };
    await simular(page, e);
    // A CME é permissão clínica por perfil (cirurgia.cme.ler e .operar, perfil central-material-esteril): a segregação de
    // funções a tira do administrador sem perfil assistencial. Quem recebe, entrega e recolhe o material é a equipe da CME.
    await entrar(page, 'SINT.CME');
    await page.goto('/cirurgia/cme/fluxo');
    await expect(page.getByTestId('tela-cme-fluxo')).toBeVisible();
    await semViolacaoAxe(page, 'fluxo do material esterilizado');

    // Fila: o cancelamento trava sem motivo; a CME recebe a solicitação aberta.
    await expect(page.getByTestId('cme-fluxo-cancelar-41')).toBeDisabled();
    await page.getByTestId('cme-fluxo-receber-41').click();
    await expect(page.getByTestId('cme-fluxo-aviso')).toContainText('SME-000041');
    await expect(page.getByTestId('cme-fluxo-receber-41')).toHaveCount(0);

    // Entrega ao setor: trava sem os campos e envia o pacote escolhido.
    await expect(page.getByTestId('cme-fluxo-entregar')).toBeDisabled();
    await escolher(page.getByTestId('cme-fluxo-entrega-solicitacao'), { rotulo: /SME-000041/ });
    await escolher(page.getByTestId('cme-fluxo-entrega-cme'), { rotulo: 'SETOR SINTETICO CME' });
    await escolher(page.getByTestId('cme-fluxo-entrega-setor'), { rotulo: 'SETOR SINTETICO UTI' });
    await expect(page.getByTestId('cme-fluxo-entregar')).toBeDisabled();
    await page.getByTestId('cme-fluxo-entrega-pacote-61').check();
    await page.getByTestId('cme-fluxo-entregar').click();
    await expect(page.getByTestId('cme-fluxo-aviso')).toContainText('81');
    expect(e.corpos['entrega']).toEqual({ solicitacao: 41, cme: 11, setor: 12, pacotes: [61] });

    // O setor confere o movimento.
    await page.getByTestId('cme-fluxo-conferir-81').click();
    await expect(page.getByTestId('cme-fluxo-conferir-81')).toHaveCount(0);
    expect(e.movimento).toBe('conferido');

    // Recolhimento: o pacote do setor volta íntegro.
    await escolher(page.getByTestId('cme-fluxo-recolhimento-cme'), { rotulo: 'SETOR SINTETICO CME' });
    await escolher(page.getByTestId('cme-fluxo-recolhimento-setor'), { rotulo: 'SETOR SINTETICO UTI' });
    await page.getByTestId('cme-fluxo-recolher-pacote-61').check();
    await page.getByTestId('cme-fluxo-integro-61').check();
    await page.getByTestId('cme-fluxo-recolher').click();
    await expect(page.getByTestId('cme-fluxo-aviso')).toContainText('1 ao arsenal');
    expect(e.corpos['recolhimento']).toEqual({
      cme: 11,
      setor: 12,
      observacao: null,
      pacotes: [{ pacote: 61, integro: true }],
    });

    // Permissão por setor: colaborador pela busca remota, setor e marcas.
    await expect(page.getByTestId('cme-fluxo-gravar-permissao')).toBeDisabled();
    // Busca remota: o rótulo digitado na caixa embutida vai ao servidor, que devolve o colaborador.
    await escolher(page.getByTestId('cme-fluxo-permissao-usuario'), {
      rotulo: 'COLABORADOR SINTETICO (sint.colab)',
    });
    await escolher(page.getByTestId('cme-fluxo-permissao-setor'), { rotulo: 'SETOR SINTETICO UTI' });
    await page.getByTestId('cme-fluxo-marca-expurgo').check();
    await page.getByTestId('cme-fluxo-marca-saidaArsenal').check();
    await page.getByTestId('cme-fluxo-gravar-permissao').click();
    await expect(page.getByTestId('cme-fluxo-permissoes')).toContainText('COLABORADOR SINTETICO');
    expect(e.corpos['permissao']).toMatchObject({
      usuario: 7,
      setor: 12,
      expurgo: true,
      saidaArsenal: true,
      lavagem: false,
    });
    await semViolacaoAxe(page, 'fluxo do material esterilizado com movimentos');
  });
});
