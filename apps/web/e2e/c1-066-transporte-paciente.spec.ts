// C1-066 (03-PEP linha 125): pedido de transporte do paciente na alta, na transferência e entre setores. A visão da
// internação (/internacao/:reg/transporte) valida o pedido na hora, com a mesma regra do domínio que a API aplica:
//   - o transporte entre setores pede o setor de destino;
//   - o que sai do hospital pede o estabelecimento ou o endereço;
//   - a previsão no passado é recusada;
//   - o botão só se habilita sem problema.
// A fila do transporte (/internacao/transportes) abre pelo atalho e pelo menu. Axe em cada passo.
// O segundo caso simula as rotas do transporte (page.route com respostas sintéticas) e exercita o ciclo pela tela: o
// pedido de retorno do exame externo para a própria unidade (origem externa), agendar com previsão e meio, saída com a
// ambulância, chegada com a distância e cancelar com motivo, conferindo o corpo enviado e os botões pela regra.
// O E2E roda sem banco próprio (fonte sintética), e as rotas do transporte respondem 503. O que fica no banco é provado
// pelo contrato de efeito transporte-paciente-propria.int.spec.ts:
//   - o pedido ligado à internação e à alta;
//   - agendar, saída e chegada;
//   - cancelar com motivo sem apagar;
//   - as recusas.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
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

/** Data e hora local no formato do campo datetime-local. */
const local = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(
    d.getHours(),
  ).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

test.describe('internação: pedido de transporte do paciente @C1-066', () => {
  test.setTimeout(180_000);

  test('validação na hora do pedido pela internação, atalho para a fila; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.INTERNACAO');
    await page.goto('/internacao/1/transporte');
    await expect(page.getByTestId('tela-transporte')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Transporte do paciente');
    await semViolacaoAxe(page, '/internacao/1/transporte (abertura)');

    const pedir = page.getByTestId('transporte-pedir');
    const problemas = page.getByTestId('transporte-problemas');
    // Entre setores (o tipo inicial sem a internação carregada): o setor de destino é pedido na hora.
    await expect(problemas).toContainText('Este transporte vai a um setor do hospital: escolha o setor.');
    await expect(pedir).toBeDisabled();

    // Transferência externa: o setor some, e o estabelecimento ou o endereço passa a ser pedido.
    await escolher(page.getByTestId('transporte-tipo'), 'transferencia_externa');
    await expect(page.getByTestId('transporte-destino-setor')).toHaveCount(0);
    await expect(problemas).toContainText('Informe o estabelecimento de destino ou o endereço.');
    await page.getByTestId('transporte-destino-descricao').fill('Hospital de referência sintético');
    await expect(problemas).not.toContainText('estabelecimento de destino');

    // Previsão no passado: recusada na hora; no futuro, o aviso some.
    await page.getByTestId('transporte-previsto').fill(local(new Date(Date.now() - 3 * 3_600_000)));
    await expect(problemas).toContainText('A previsão do transporte não pode estar no passado.');
    await page.getByTestId('transporte-previsto').fill(local(new Date(Date.now() + 3 * 3_600_000)));
    await expect(problemas).not.toContainText('previsão');
    await page.getByTestId('transporte-oxigenio').check();
    await escolher(page.getByTestId('transporte-prioridade'), 'urgente');
    // Sem a internação do banco do cliente (503), o botão continua travado.
    await expect(pedir).toBeDisabled();
    await semViolacaoAxe(page, '/internacao/1/transporte (pedido em preenchimento)');

    // Atalho para a fila do transporte.
    await page.getByTestId('transporte-ir-fila').click();
    await expect(page).toHaveURL(/\/internacao\/transportes$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Transporte de pacientes');
    await expect(page.getByTestId('transporte-form')).toHaveCount(0);
    await semViolacaoAxe(page, '/internacao/transportes (fila)');
    expect(externas).toEqual([]);
  });

  test('ciclo pela tela com a API simulada: retorno, agendar, saída, chegada e cancelar; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const corpos: { url: string; corpo: Record<string, unknown> }[] = [];
    const json = (rota: Route, corpo: unknown) =>
      rota.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corpo) });
    const item = (id: number, extra: Record<string, unknown>) => ({
      id,
      paciente: 1001,
      prontuario: 'SINT-1',
      internacao: 1,
      internacaoNumero: 'INT-SINT-1',
      tipo: 'exame_externo',
      prioridade: 'rotina',
      meio: null,
      meioNome: null,
      meioExigeAmbulancia: false,
      ambulancia: null,
      ambulanciaPlaca: null,
      origemNome: 'Setor sintético A',
      destinoNome: 'Clínica sintética',
      condicao: null,
      requerOxigenio: false,
      requerMonitorizacao: false,
      requerMaca: false,
      acompanhanteNome: null,
      solicitado: '2026-11-25T10:00:00',
      previsto: null,
      saida: null,
      chegada: null,
      retorno: null,
      distanciaKm: null,
      situacao: 'solicitado',
      motivoCancelamento: null,
      observacao: null,
      versao: 1,
      ...extra,
    });
    const itens: Record<string, unknown>[] = [item(502, {})];
    const mudar = (id: number, extra: Record<string, unknown>) => {
      const i = itens.findIndex((x) => x['id'] === id);
      itens[i] = { ...itens[i], ...extra, versao: Number(itens[i]!['versao']) + 1 };
    };

    await page.route(/\/api\/internacao\/transportes\/opcoes$/, (r) =>
      json(r, {
        meios: [
          { id: 1, nome: 'Cadeira de rodas sintética', exigeAmbulancia: false },
          { id: 2, nome: 'Ambulância sintética', exigeAmbulancia: true },
        ],
        posicoes: [],
        ambulancias: [{ id: 5, nome: 'Veículo sintético 5' }],
        setores: [
          { id: 10, nome: 'Setor sintético A' },
          { id: 11, nome: 'Setor sintético B' },
        ],
        externos: [],
        motivos: [{ id: 3, nome: 'Exame remarcado' }],
      }),
    );
    await page.route(/\/api\/internacao\/transportes\/internacao\/1$/, (r) =>
      json(r, {
        id: 1,
        numero: 'INT-SINT-1',
        paciente: 1001,
        prontuario: 'SINT-1',
        atendimento: 2001,
        situacao: 'ativa',
        setorAtual: 10,
        alta: null,
        tipoSugerido: 'interno',
      }),
    );
    await page.route(/\/api\/internacao\/transportes(\?.*)?$/, async (r) => {
      if (r.request().method() === 'POST') {
        corpos.push({ url: '/api/internacao/transportes', corpo: r.request().postDataJSON() });
        itens.unshift(
          item(501, {
            tipo: 'retorno',
            origemNome: 'Clínica de imagem sintética',
            destinoNome: 'Setor sintético A',
          }),
        );
        return json(r, { id: 501 });
      }
      return json(r, { itens });
    });
    await page.route(
      /\/api\/internacao\/transportes\/\d+\/(agendar|iniciar|concluir|cancelar)$/,
      async (r) => {
        const url = new URL(r.request().url()).pathname;
        const corpo = r.request().postDataJSON() as Record<string, unknown>;
        corpos.push({ url, corpo });
        const [, id, acao] = /\/(\d+)\/(\w+)$/.exec(url)!;
        const situacao = {
          agendar: 'agendado',
          iniciar: 'em_andamento',
          concluir: 'concluido',
          cancelar: 'cancelado',
        };
        mudar(Number(id), {
          situacao: situacao[acao as keyof typeof situacao],
          ...(acao === 'agendar'
            ? {
                previsto: corpo['previsto'],
                meio: 2,
                meioNome: 'Ambulância sintética',
                meioExigeAmbulancia: true,
              }
            : {}),
          ...(acao === 'iniciar'
            ? {
                ambulancia: 5,
                ambulanciaPlaca: 'Veículo sintético 5',
                saida: new Date(Date.now() - 30 * 60_000).toISOString(),
              }
            : {}),
          ...(acao === 'concluir'
            ? { chegada: new Date().toISOString(), distanciaKm: corpo['distanciaKm'] }
            : {}),
          ...(acao === 'cancelar' ? { motivoCancelamento: 'Exame remarcado' } : {}),
        });
        return json(r, { id: Number(id) });
      },
    );

    await entrar(page, 'SINT.INTERNACAO');
    await page.goto('/internacao/1/transporte');
    await expect(page.getByTestId('transporte-internacao')).toContainText('INT-SINT-1');
    await expect(page.getByTestId('transporte-form')).toBeVisible();
    const pedir = page.getByTestId('transporte-pedir');
    const problemas = page.getByTestId('transporte-problemas');

    // Retorno do exame externo para o setor em que o paciente está internado: a origem é o local de onde ele volta.
    await escolher(page.getByTestId('transporte-tipo'), 'retorno');
    await escolher(page.getByTestId('transporte-destino-setor'), '10');
    await expect(problemas).toContainText(
      'O retorno vem de fora do hospital: informe o local de onde o paciente volta.',
    );
    await expect(problemas).not.toContainText('mesmo setor');
    await expect(pedir).toBeDisabled();
    await page.getByTestId('transporte-origem-descricao').fill('Clínica de imagem sintética');
    await expect(problemas).toHaveCount(0);
    await expect(pedir).toBeEnabled();
    await pedir.click();
    await expect(page.getByTestId('transporte-aviso')).toHaveText('Transporte pedido.');
    expect(corpos[0]).toMatchObject({
      url: '/api/internacao/transportes',
      corpo: {
        internacao: 1,
        tipo: 'retorno',
        prioridade: 'rotina',
        origemSetor: null,
        origemDescricao: 'Clínica de imagem sintética',
        destinoSetor: 10,
        destinoExterno: null,
      },
    });
    await expect(page.getByTestId('transporte-501')).toContainText('Clínica de imagem sintética');
    await semViolacaoAxe(page, '/internacao/1/transporte (pedido de retorno na lista)');

    // Ações na fila: sem previsão, meio nem motivo, nada se habilita; a chegada só aparece depois da saída.
    const botao = (acao: string, id: number) => page.getByTestId(`transporte-${acao}-${id}`);
    await expect(botao('agendar', 501)).toBeDisabled();
    await expect(botao('iniciar', 501)).toBeDisabled();
    await expect(botao('cancelar', 501)).toBeDisabled();
    await expect(botao('concluir', 501)).toHaveCount(0);

    // Agendar com previsão e meio de ambulância; a saída fica travada até informar o veículo.
    const previsao = local(new Date(Date.now() + 2 * 3_600_000));
    await page.getByTestId('transporte-nova-previsao').fill(previsao);
    await escolher(page.getByTestId('transporte-meio-acao'), '2');
    await expect(botao('agendar', 501)).toBeEnabled();
    await expect(botao('iniciar', 501)).toBeDisabled();
    await botao('agendar', 501).click();
    await expect(page.getByTestId('transporte-501')).toContainText('Agendado');
    expect(corpos[1]).toMatchObject({
      url: '/api/internacao/transportes/501/agendar',
      corpo: { meio: 2, ambulancia: null, versao: 1 },
    });
    expect(new Date(String(corpos[1]!.corpo['previsto'])).getTime()).toBe(new Date(previsao).getTime());

    // Saída com o veículo.
    await escolher(page.getByTestId('transporte-ambulancia'), '5');
    await expect(botao('iniciar', 501)).toBeEnabled();
    await botao('iniciar', 501).click();
    await expect(page.getByTestId('transporte-501')).toContainText('Em andamento');
    expect(corpos[2]).toEqual({
      url: '/api/internacao/transportes/501/iniciar',
      corpo: { ambulancia: 5, versao: 2 },
    });
    // Depois da saída, não se cancela nem se agenda: só a chegada.
    await expect(botao('cancelar', 501)).toHaveCount(0);
    await expect(botao('agendar', 501)).toHaveCount(0);

    // Chegada com a distância.
    await page.getByTestId('transporte-distancia').fill('12.5');
    await expect(botao('concluir', 501)).toBeEnabled();
    await botao('concluir', 501).click();
    await expect(page.getByTestId('transporte-501')).toContainText('Concluído');
    expect(corpos[3]).toEqual({
      url: '/api/internacao/transportes/501/concluir',
      corpo: { distanciaKm: 12.5, versao: 3 },
    });
    await expect(botao('concluir', 501)).toHaveCount(0);

    // Cancelar o outro pedido: travado sem motivo; com o motivo, cancela e não some da lista.
    await expect(botao('cancelar', 502)).toBeDisabled();
    await escolher(page.getByTestId('transporte-motivo'), '3');
    await expect(botao('cancelar', 502)).toBeEnabled();
    await botao('cancelar', 502).click();
    await expect(page.getByTestId('transporte-502')).toContainText('Cancelado');
    await expect(page.getByTestId('transporte-502')).toContainText('Exame remarcado');
    expect(corpos[4]).toEqual({
      url: '/api/internacao/transportes/502/cancelar',
      corpo: { motivo: 3, versao: 1 },
    });
    // Sem pedido em aberto, os campos das ações somem; o histórico fica.
    await expect(page.getByTestId('transporte-acoes')).toHaveCount(0);
    await expect(page.getByTestId('tabela-transportes').locator('tbody tr')).toHaveCount(2);
    await semViolacaoAxe(page, '/internacao/1/transporte (ciclo concluído)');
    expect(corpos).toHaveLength(5);
    expect(externas).toEqual([]);
  });
});
