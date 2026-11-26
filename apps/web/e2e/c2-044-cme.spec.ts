// F7 (05-SUP linha 29) @C2-044: central de material esterilizado (CME; RDC 15/2012) pelo caminho da tela. As rotas
// exigem o banco próprio e o E2E roda com a fonte sintética, então as respostas da API são simuladas pelo Playwright
// com massa SINTÉTICA e um estado que avança a cada gravação. O que se prova é a tela: o equipamento se cadastra; o
// pedido da cirurgia trava sem caixa e sem setor e grava com tudo escolhido; o item pendente vira pacote com etiqueta;
// a carga trava sem pacote e abre o ciclo com o pacote aguardando; a conclusão trava sem os indicadores físico e
// químico e libera o lote com os dois conformes; o pacote pronto sai para a cirurgia; a etiqueta lida mostra o caminho
// até o paciente e o uso fica registrado. O efeito no banco está no contrato de efeito
// apps/api/src/modulos/cirurgia/cme-propria.int.spec.ts.
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

const ETIQUETA = 'CME-0001-000001';

/** Estado sintético da CME, que avança a cada gravação. */
interface Estado {
  equipamentos: { id: number; codigo: string; descricao: string; metodo: number | null }[];
  solicitado: boolean;
  item: 'pendente' | 'em_processamento' | 'pronto' | 'entregue';
  pacote: 'aguardando_esterilizacao' | 'esteril' | 'distribuido' | 'usado' | null;
  ciclo: 'em_andamento' | 'liberado' | null;
  usado: boolean;
  corpos: Record<string, unknown>;
}

function painel(e: Estado) {
  const pacote =
    e.pacote === null
      ? []
      : [
          {
            id: 61,
            etiqueta: ETIQUETA,
            caixa: 41,
            produto: 'CAIXA SINTETICA',
            situacao: e.pacote,
            ciclo: e.ciclo ? 71 : null,
            lote: e.ciclo ? 'L000001' : null,
            validade: e.ciclo === 'liberado' ? '2026-12-25' : null,
            versao: 1,
          },
        ];
  return {
    setores: [
      { id: 5, nome: 'CME SINTETICA' },
      { id: 6, nome: 'BLOCO SINTETICO' },
    ],
    unidades: [{ id: 8, nome: 'UNIDADE SINTETICA' }],
    agendamentos: [
      { id: 81, numero: 'AG-SINT-1', paciente: 'PACIENTE SINTETICO', inicio: '2026-11-26T08:00:00' },
    ],
    caixas: [
      {
        id: 41,
        codigo: 'CX-SINT',
        descricao: 'CAIXA SINTETICA',
        validadeDias: 30,
        reprocessamentos: 0,
        limite: null,
        pecas: 2,
      },
    ],
    equipamentos: e.equipamentos,
    metodos: [{ id: 3, codigo: 'VAP', descricao: 'VAPOR SINTETICO' }],
    pacotes: pacote,
    ciclos: e.ciclo
      ? [
          {
            id: 71,
            numero: 'CE-000001',
            lote: 'L000001',
            equipamento: 'AUTOCLAVE SINTETICA',
            metodo: 'VAPOR SINTETICO',
            situacao: e.ciclo,
            inicio: '2026-11-25T09:00:00',
            fim: e.ciclo === 'liberado' ? '2026-11-25T10:00:00' : null,
            fisico: e.ciclo === 'liberado',
            quimico: e.ciclo === 'liberado',
            biologico: false,
            pacotes: 1,
            versao: e.ciclo === 'liberado' ? 2 : 1,
          },
        ]
      : [],
    solicitacoes:
      e.solicitado && e.item !== 'entregue'
        ? [
            {
              id: 91,
              numero: 'SME-000001',
              tipo: 'cirurgia',
              situacao:
                e.item === 'pendente' ? 'aberta' : e.item === 'pronto' ? 'pronta' : 'em_processamento',
              agendamento: 81,
              itens: [{ id: 92, caixa: 41, quantidade: 1, situacao: e.item, pacote: e.pacote ? 61 : null }],
            },
          ]
        : [],
  };
}

function rastreio(e: Estado) {
  return {
    pacote: {
      ...painel(e).pacotes[0]!,
      esterilizadoEm: '2026-11-25T10:00:00',
      preparadoPor: 'USUARIO SINTETICO',
      metodo: 'VAPOR SINTETICO',
      faltasEtiqueta: [],
    },
    ciclo: painel(e).ciclos[0] ?? null,
    cirurgias: [
      {
        movimento: 101,
        agendamento: 81,
        agendamentoNumero: 'AG-SINT-1',
        atendimento: 111,
        paciente: 121,
        pacienteNome: 'PACIENTE SINTETICO',
        entregueEm: '2026-11-25T11:00:00',
        usado: e.usado,
      },
    ],
    usos: [],
  };
}

async function simular(page: Page, e: Estado): Promise<void> {
  const corpo = (r: Route) => r.request().postDataJSON() as Record<string, unknown>;
  await page.route('**/api/cirurgia/cme', (r) => json(r, painel(e)));
  await page.route('**/api/cirurgia/cme/equipamentos', (r) => {
    e.corpos['equipamento'] = corpo(r);
    e.equipamentos.push({ id: 51, codigo: 'AUT-SINT', descricao: 'AUTOCLAVE SINTETICA', metodo: 3 });
    return json(r, { equipamento: 51 }, 201);
  });
  await page.route('**/api/cirurgia/cme/solicitacoes', (r) => {
    e.corpos['solicitacao'] = corpo(r);
    e.solicitado = true;
    return json(r, { solicitacao: 91, numero: 'SME-000001' }, 201);
  });
  await page.route('**/api/cirurgia/cme/pacotes', (r) => {
    e.corpos['pacote'] = corpo(r);
    e.item = 'em_processamento';
    e.pacote = 'aguardando_esterilizacao';
    return json(r, { pacote: 61, etiqueta: ETIQUETA }, 201);
  });
  await page.route('**/api/cirurgia/cme/ciclos', (r) => {
    e.corpos['ciclo'] = corpo(r);
    e.ciclo = 'em_andamento';
    return json(r, { ciclo: 71, numero: 'CE-000001' }, 201);
  });
  await page.route('**/api/cirurgia/cme/ciclos/71/concluir', (r) => {
    e.corpos['concluir'] = corpo(r);
    e.ciclo = 'liberado';
    e.pacote = 'esteril';
    e.item = 'pronto';
    return json(r, { situacao: 'liberado', motivo: 'Indicadores conformes.' });
  });
  await page.route('**/api/cirurgia/cme/pacotes/61/entregar', (r) => {
    e.corpos['entregar'] = corpo(r);
    e.pacote = 'distribuido';
    e.item = 'entregue';
    return json(r, { movimento: 101 }, 201);
  });
  await page.route(/\/api\/cirurgia\/cme\/rastreio\?/, (r) => json(r, rastreio(e)));
  await page.route('**/api/cirurgia/cme/pacotes/61/usar', (r) => {
    e.corpos['usar'] = corpo(r);
    e.pacote = 'usado';
    e.usado = true;
    return json(r, { movimento: 101 });
  });
}

test.describe('@C2-044 central de material esterilizado (05-SUP linha 29)', () => {
  test('do pedido da cirurgia ao paciente: pacote, carga, indicadores, entrega e uso', async ({ page }) => {
    const e: Estado = {
      equipamentos: [],
      solicitado: false,
      item: 'pendente',
      pacote: null,
      ciclo: null,
      usado: false,
      corpos: {},
    };
    await simular(page, e);
    await entrar(page, 'SINT.CME');
    await page.goto('/cirurgia/cme');
    await expect(page.getByTestId('tela-cme')).toBeVisible();
    await semViolacaoAxe(page, 'central de material esterilizado');

    // Equipamento: código e descrição obrigatórios na hora.
    await expect(page.getByTestId('cme-eq-salvar')).toBeDisabled();
    await page.getByTestId('cme-eq-codigo').fill('AUT-SINT');
    await page.getByTestId('cme-eq-descricao').fill('AUTOCLAVE SINTETICA');
    await escolher(page.getByTestId('cme-eq-metodo'), { rotulo: 'VAPOR SINTETICO' });
    await page.getByTestId('cme-eq-salvar').click();
    await expect(page.getByTestId('cme-aviso')).toContainText('Gravado');
    expect(e.corpos['equipamento']).toMatchObject({ codigo: 'AUT-SINT', natureza: 'autoclave', metodo: 3 });

    // Pedido da cirurgia: trava sem caixa e sem setor.
    await expect(page.getByTestId('cme-pedir')).toBeDisabled();
    await escolher(page.getByTestId('cme-sol-caixa'), { rotulo: 'CAIXA SINTETICA' });
    await escolher(page.getByTestId('cme-sol-agendamento'), { rotulo: /AG-SINT-1/ });
    await expect(page.getByTestId('cme-pedir')).toBeDisabled();
    await escolher(page.getByTestId('cme-sol-unidade'), { rotulo: 'UNIDADE SINTETICA' });
    await page.getByTestId('cme-pedir').click();
    await expect(page.getByTestId('cme-sol-item-92')).toContainText('Pendente');
    expect(e.corpos['solicitacao']).toMatchObject({
      tipo: 'cirurgia',
      setor: 8,
      agendamento: 81,
      itens: [{ caixa: 41, quantidade: 1 }],
    });

    // O item pendente vira pacote com etiqueta.
    await page.getByTestId('cme-preparar-92').click();
    await expect(page.getByTestId('cme-aviso')).toContainText(ETIQUETA);
    expect(e.corpos['pacote']).toEqual({ caixa: 41, solicitacaoItem: 92 });

    // Carga: trava sem pacote; abre o ciclo com o pacote aguardando.
    await escolher(page.getByTestId('cme-carga-equipamento'), { rotulo: 'AUTOCLAVE SINTETICA' });
    await escolher(page.getByTestId('cme-carga-metodo'), { rotulo: 'VAPOR SINTETICO' });
    await expect(page.getByTestId('cme-abrir-ciclo')).toBeDisabled();
    await page.getByTestId(`cme-carga-pacote-${ETIQUETA}`).check();
    await page.getByTestId('cme-abrir-ciclo').click();
    await expect(page.getByTestId('cme-ciclo-situacao-CE-000001')).toHaveText('Em andamento');
    expect(e.corpos['ciclo']).toEqual({ equipamento: 51, metodo: 3, pacotes: [61] });

    // Conclusão: trava sem físico e químico; libera com os dois conformes.
    await expect(page.getByTestId('cme-concluir-CE-000001')).toBeDisabled();
    await escolher(page.getByTestId('cme-fisico-CE-000001'), { rotulo: 'Conforme' });
    await expect(page.getByTestId('cme-concluir-CE-000001')).toBeDisabled();
    await escolher(page.getByTestId('cme-quimico-CE-000001'), { rotulo: 'Conforme' });
    await page.getByTestId('cme-concluir-CE-000001').click();
    await expect(page.getByTestId('cme-ciclo-situacao-CE-000001')).toHaveText('Liberado');
    expect(e.corpos['concluir']).toMatchObject({ versao: 1, fisico: 'conforme', quimico: 'conforme' });

    // Entrega à cirurgia: setores da CME e do destino.
    await escolher(page.getByTestId('cme-entrega-cme'), { rotulo: 'CME SINTETICA' });
    await escolher(page.getByTestId('cme-entrega-setor'), { rotulo: 'BLOCO SINTETICO' });
    await page.getByTestId('cme-entregar-92').click();
    await expect(page.getByTestId('cme-aviso')).toContainText('Gravado');
    expect(e.corpos['entregar']).toEqual({ agendamento: 81, cme: 5, setor: 6 });

    // Rastreio pela etiqueta até o paciente e registro do uso.
    await page.getByTestId('cme-etiqueta').fill(ETIQUETA);
    await page.getByTestId('cme-rastrear').click();
    await expect(page.getByTestId('cme-rastreio-situacao')).toHaveText('Entregue');
    await expect(page.getByTestId('cme-rastreio-cirurgias')).toContainText('PACIENTE SINTETICO');
    await page.getByTestId('cme-integridade').check();
    await page.getByTestId('cme-usar').click();
    await expect(page.getByTestId('cme-rastreio-situacao')).toHaveText('Usado');
    await expect(page.getByTestId('cme-usar')).toHaveCount(0);
    expect(e.corpos['usar']).toEqual({
      agendamento: 81,
      integridadeConferida: true,
      indicadorExternoOk: true,
    });
  });
});
