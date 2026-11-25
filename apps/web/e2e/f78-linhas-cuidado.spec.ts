// F8 (02-CAD linha 11): programas de saúde e linhas de cuidado do paciente, pelo caminho da tela. As rotas dos programas
// exigem o banco próprio e o E2E roda com a fonte sintética (sem núcleo): elas são simuladas pelo Playwright com massa
// SINTÉTICA. O que se prova é a tela: a seção só aparece a quem tem cadastro.linhaCuidado.ler (a recepção não vê:
// LGPD art. 11), a inscrição com validação na hora (programa que exige o profissional de referência não libera sem ele),
// a mudança só para os próximos estados com o motivo pedido ao encerrar, a inscrição encerrada que continua no
// histórico, o painel por estado e a lista nominal com o paciente restrito pelo pseudônimo, e a acessibilidade. O efeito
// no banco está no contrato de efeito (apps/api/src/modulos/cadastro/linhas-cuidado-proprio.int.spec.ts).
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const PACIENTE = 1001;

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

interface Pedido {
  readonly metodo: string;
  readonly caminho: string;
  readonly corpo: Record<string, unknown>;
}

const HOJE = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const ESTADOS = [
  { id: 1, codigo: 'INC', descricao: 'INCLUIDO SINTETICO', tipo: 'incluido', encerra: false, ativo: true },
  { id: 2, codigo: 'ATV', descricao: 'ATIVO SINTETICO', tipo: 'ativo', encerra: false, ativo: true },
  { id: 3, codigo: 'SUS', descricao: 'SUSPENSO SINTETICO', tipo: 'suspenso', encerra: false, ativo: true },
  { id: 4, codigo: 'ALT', descricao: 'ALTA SINTETICA', tipo: 'alta', encerra: true, ativo: true },
];
const programa = (id: number, codigo: string, descricao: string, exigeReferencia: boolean) => ({
  id,
  codigo,
  descricao,
  codigoExterno: null,
  publicoAlvo: null,
  criterioEntrada: exigeReferencia ? 'CRITERIO SINTETICO' : null,
  criterioSaida: null,
  faixaEtaria: null,
  exigeReferencia,
  ativo: true,
  versao: 1,
  inscritosVivos: 2,
  encerradas: 1,
  porEstado: { ativo: 1, suspenso: 1, alta: 1 },
});
const PROGRAMAS = [
  programa(10, 'HAS', 'PROGRAMA SINTETICO HIPERTENSAO', true),
  programa(11, 'PUE', 'PROGRAMA SINTETICO PUERICULTURA', false),
];

async function simular(page: Page, pedidos: Pedido[]): Promise<void> {
  const inscricoes: Record<string, unknown>[] = [];
  await page.route('**/api/cadastros/linhas-cuidado', (r) =>
    json(r, { linhas: PROGRAMAS, estados: ESTADOS, faixas: [{ id: 5, descricao: 'FAIXA SINTETICA' }] }),
  );
  await page.route('**/api/cadastros/linhas-cuidado/*/inscritos**', (r) =>
    json(r, {
      itens: [
        {
          inscricao: 1,
          paciente: 2001,
          nome: 'PACIENTE SINTETICO UM',
          restrito: false,
          estado: 'ATIVO SINTETICO',
          tipo: 'ativo',
          estadoDesde: '2026-10-01',
          vigenciaInicio: '2026-10-01',
          referencia: 'PROFISSIONAL SINTETICO',
        },
        {
          inscricao: 2,
          paciente: 2002,
          nome: 'PSEUDONIMO-0002',
          restrito: true,
          estado: 'SUSPENSO SINTETICO',
          tipo: 'suspenso',
          estadoDesde: '2026-10-05',
          vigenciaInicio: '2026-09-01',
          referencia: null,
        },
      ],
    }),
  );
  await page.route('**/api/cadastros/profissionais?**', (r) =>
    json(r, {
      itens: [
        {
          id: 77,
          nome: 'PROFISSIONAL SINTETICO',
          categoria: 'medico',
          registros: [],
          situacaoLegado: { codigo: null, aConfirmar: true },
          ativo: true,
        },
      ],
      truncado: false,
      sugestoes: [],
    }),
  );
  await page.route(`**/api/cadastros/pacientes/${PACIENTE}/linhas-cuidado**`, async (rota) => {
    const req = rota.request();
    const caminho = new URL(req.url()).pathname.replace('/api/cadastros/', '');
    if (req.method() === 'GET') return json(rota, { itens: inscricoes });
    const corpo = (req.postDataJSON() ?? {}) as Record<string, unknown>;
    pedidos.push({ metodo: req.method(), caminho, corpo });
    if (caminho.endsWith('/estado')) {
      const i = inscricoes[0]!;
      const e = ESTADOS.find((x) => x.id === corpo['estado'])!;
      Object.assign(i, {
        estado: { id: e.id, descricao: e.descricao, tipo: e.tipo },
        estadoDesde: corpo['data'],
        vigenciaFim: e.encerra ? corpo['data'] : null,
        motivoSaida: e.encerra ? corpo['motivo'] : null,
        encerrada: e.encerra,
        versao: 2,
        proximos: e.encerra ? [] : [2, 3, 4].filter((x) => x !== e.id),
      });
      (i['historico'] as unknown[]).unshift({
        ocorridoEm: `${HOJE}T11:00:00`,
        operacao: 'alteracao',
        estado: e.descricao,
        usuario: 'SINT.MEDICO',
      });
      return json(rota, { id: 500, encerrada: e.encerra });
    }
    inscricoes.push({
      id: 500,
      linha: { id: 10, codigo: 'HAS', descricao: 'PROGRAMA SINTETICO HIPERTENSAO' },
      estado: { id: 1, descricao: 'INCLUIDO SINTETICO', tipo: 'incluido' },
      estadoDesde: corpo['vigenciaInicio'],
      referencia: { id: 77, nome: 'PROFISSIONAL SINTETICO' },
      vigenciaInicio: corpo['vigenciaInicio'],
      vigenciaFim: null,
      motivoSaida: null,
      encerrada: false,
      versao: 1,
      proximos: [2, 3, 4],
      historico: [
        {
          ocorridoEm: `${HOJE}T10:00:00`,
          operacao: 'inclusao',
          estado: 'INCLUIDO SINTETICO',
          usuario: 'SINT.MEDICO',
        },
      ],
    });
    return json(rota, { id: 500 }, 201);
  });
}

test.describe('@C1-011 @F78.02-1 programas de saúde e linhas de cuidado', () => {
  test.describe.configure({ timeout: 240_000 });

  test('ficha: inscreve com o profissional de referência, encerra com motivo sem apagar; axe', async ({
    page,
  }) => {
    const pedidos: Pedido[] = [];
    await entrar(page, 'SINT.MEDICO');
    await simular(page, pedidos);

    await page.goto(`/cadastros/pacientes/${PACIENTE}`);
    const sec = page.getByTestId('linhas-cuidado-paciente');
    await expect(sec.getByText('O paciente não está em nenhum programa.')).toBeVisible();
    const form = sec.getByTestId('nova-inscricao');
    const inscrever = form.getByRole('button', { name: 'Inscrever no programa' });
    await expect(inscrever).toBeDisabled();

    // O programa que exige o profissional de referência não libera sem ele (validação na hora, sem ida ao servidor).
    await escolher(form.getByRole('combobox', { name: 'Programa' }), {
      rotulo: 'PROGRAMA SINTETICO HIPERTENSAO',
    });
    await expect(form.getByText('Este programa exige o profissional de referência.')).toBeVisible();
    await expect(form.getByText('CRITERIO SINTETICO')).toBeVisible();
    await expect(inscrever).toBeDisabled();
    await form.getByLabel('Buscar profissional (3 letras ou mais)').fill('PROF');
    await escolher(form.getByRole('combobox', { name: 'Profissional de referência' }), {
      rotulo: 'PROFISSIONAL SINTETICO',
    });
    await expect(inscrever).toBeEnabled();
    await semViolacaoAxe(page, `/cadastros/pacientes/${PACIENTE} (linhas de cuidado)`);
    await inscrever.click();
    await expect(sec.getByRole('status')).toContainText('Paciente inscrito no programa.');
    const insc = sec.locator('article[data-inscricao="HAS"]');
    await expect(insc).toContainText('INCLUIDO SINTETICO');
    await expect(insc).toContainText('PROFISSIONAL SINTETICO');
    expect(pedidos[0]).toEqual({
      metodo: 'POST',
      caminho: `pacientes/${PACIENTE}/linhas-cuidado`,
      corpo: { linha: 10, referencia: 77, vigenciaInicio: HOJE },
    });
    // Uma só inscrição viva: o mesmo programa não libera de novo.
    await escolher(form.getByRole('combobox', { name: 'Programa' }), {
      rotulo: 'PROGRAMA SINTETICO HIPERTENSAO',
    });
    await expect(form.getByText(/já está neste programa/)).toBeVisible();
    await expect(inscrever).toBeDisabled();

    // Mudança só para os próximos estados; a alta pede o motivo antes de liberar.
    await insc.getByRole('button', { name: 'Mudar o estado' }).click();
    const mud = insc.getByTestId('mudar-estado');
    await escolher(mud.getByRole('combobox', { name: 'Novo estado' }), { rotulo: /ALTA SINTETICA/ });
    const gravar = mud.getByRole('button', { name: 'Gravar a mudança' });
    await expect(mud.getByText('Escreva o motivo (ao menos 5 letras).')).toBeVisible();
    await expect(gravar).toBeDisabled();
    await mud.getByLabel('Motivo').fill('Meta pressórica atingida');
    await expect(gravar).toBeEnabled();
    await gravar.click();
    await expect(sec.getByRole('status')).toContainText('Inscrição encerrada.');
    await expect(insc).toHaveAttribute('data-encerrada', 'sim');
    await expect(insc).toContainText('Meta pressórica atingida');
    await expect(insc.getByRole('button', { name: 'Mudar o estado' })).toHaveCount(0);
    expect(pedidos[1]).toEqual({
      metodo: 'POST',
      caminho: `pacientes/${PACIENTE}/linhas-cuidado/500/estado`,
      corpo: { versao: 1, estado: 4, data: HOJE, motivo: 'Meta pressórica atingida' },
    });
    await insc.getByText('Linha do tempo').click();
    await expect(insc.getByRole('table')).toContainText('Inscrição');
    await expect(insc.getByRole('table')).toContainText('ALTA SINTETICA');
  });

  test('recepção não vê os programas do paciente (LGPD art. 11)', async ({ page }) => {
    await entrar(page, 'SINT.RECEPCAO');
    await simular(page, []);
    await page.goto(`/cadastros/pacientes/${PACIENTE}`);
    await expect(page.getByTestId('coberturas-paciente')).toBeVisible();
    await expect(page.getByTestId('linhas-cuidado-paciente')).toHaveCount(0);
  });

  test('tela: painel por estado e lista nominal com o restrito pelo pseudônimo; axe', async ({ page }) => {
    await entrar(page, 'SINT.QUALIDADE');
    await simular(page, []);
    await page.goto('/cadastros/pacientes/linhas-cuidado');
    const tela = page.getByTestId('tela-linhas-cuidado');
    const linha = tela.locator('tr[data-programa="HAS"]');
    await expect(linha).toContainText('PROGRAMA SINTETICO HIPERTENSAO');
    await expect(linha).toContainText('Ativo: 1 · Suspenso: 1 · Alta: 1');
    await linha.getByRole('button', { name: 'Ver inscritos' }).click();
    const lista = tela.getByTestId('lc-inscritos');
    await expect(lista.getByRole('link', { name: 'PACIENTE SINTETICO UM' })).toBeVisible();
    const restrito = lista.locator('tr[data-restrito="sim"]');
    await expect(restrito).toContainText('PSEUDONIMO-0002 (acesso restrito)');
    await expect(restrito.getByRole('link')).toHaveCount(0);
    await semViolacaoAxe(page, '/cadastros/pacientes/linhas-cuidado');
  });
});
