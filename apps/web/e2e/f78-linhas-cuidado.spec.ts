// F8 (02-CAD linha 11): programas de saúde e linhas de cuidado do paciente, pelo caminho da tela. As rotas dos programas
// exigem o banco próprio e o E2E roda com a fonte sintética (sem núcleo): elas são simuladas pelo Playwright com massa
// SINTÉTICA. O que se prova é a tela: a seção só aparece a quem tem cadastro.linhaCuidado.ler (a recepção não vê:
// LGPD art. 11), a inscrição com validação na hora (programa que exige o profissional de referência não libera sem ele),
// a mudança só para os próximos estados com o motivo pedido ao encerrar, a inscrição encerrada que continua no
// histórico, a troca e a limpeza do profissional de referência com a linha do tempo dizendo de quem para quem, a
// suspensão que pede o motivo, a falha da busca que aparece (não vira lista vazia), o catálogo (novo programa com a
// validação na hora, alteração com o código travado e inativação sem apagar), o painel por estado e a lista nominal com
// o paciente restrito pelo pseudônimo, e a acessibilidade. A busca do profissional de referência é a rota do próprio
// programa (/api/cadastros/linhas-cuidado/profissionais), sob cadastro.linhaCuidado.inscrever, a mesma permissão de
// inscrever: quem inscreve sempre consegue buscar. O efeito no banco está no contrato de efeito
// (apps/api/src/modulos/cadastro/linhas-cuidado-proprio.int.spec.ts).
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

const inscricaoViva = (): Record<string, unknown> => ({
  id: 500,
  linha: { id: 10, codigo: 'HAS', descricao: 'PROGRAMA SINTETICO HIPERTENSAO' },
  estado: { id: 2, descricao: 'ATIVO SINTETICO', tipo: 'ativo' },
  estadoDesde: '2026-10-01',
  referencia: { id: 77, nome: 'PROFISSIONAL SINTETICO' },
  vigenciaInicio: '2026-10-01',
  vigenciaFim: null,
  motivoSaida: null,
  encerrada: false,
  versao: 1,
  proximos: [3, 4],
  historico: [
    {
      ocorridoEm: '2026-10-01T10:00:00',
      operacao: 'inclusao',
      evento: 'inscricao',
      estado: 'INCLUIDO SINTETICO',
      referenciaDe: null,
      referenciaPara: null,
      usuario: 'SINT.MEDICO',
    },
  ],
});
const PROFISSIONAIS = [
  { id: 77, nome: 'PROFISSIONAL SINTETICO' },
  { id: 88, nome: 'PROFISSIONAL SINTETICO DOIS' },
];

async function simular(
  page: Page,
  pedidos: Pedido[],
  opcoes: { inscricoes?: Record<string, unknown>[]; buscaStatus?: number } = {},
): Promise<void> {
  const inscricoes: Record<string, unknown>[] = opcoes.inscricoes ?? [];
  await page.route('**/api/cadastros/linhas-cuidado', (r) => {
    const req = r.request();
    if (req.method() === 'GET')
      return json(r, {
        linhas: PROGRAMAS,
        estados: ESTADOS,
        faixas: [{ id: 5, descricao: 'FAIXA SINTETICA' }],
      });
    pedidos.push({ metodo: req.method(), caminho: 'linhas-cuidado', corpo: req.postDataJSON() ?? {} });
    return json(r, { id: 12 }, 201);
  });
  await page.route('**/api/cadastros/linhas-cuidado/1*', (r) => {
    const req = r.request();
    if (req.method() !== 'PUT') return r.fallback();
    const caminho = new URL(req.url()).pathname.replace('/api/cadastros/', '');
    pedidos.push({ metodo: 'PUT', caminho, corpo: req.postDataJSON() ?? {} });
    return json(r, { id: Number(caminho.split('/').pop()) });
  });
  await page.route('**/api/cadastros/linhas-cuidado/profissionais?**', (r) =>
    opcoes.buscaStatus
      ? json(
          r,
          {
            type: 'about:blank',
            title: 'Sem permissão',
            status: opcoes.buscaStatus,
            detail: 'Sem permissão para buscar (sintético).',
          },
          opcoes.buscaStatus,
        )
      : json(r, { itens: PROFISSIONAIS }),
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
  await page.route(`**/api/cadastros/pacientes/${PACIENTE}/linhas-cuidado**`, async (rota) => {
    const req = rota.request();
    const caminho = new URL(req.url()).pathname.replace('/api/cadastros/', '');
    if (req.method() === 'GET') return json(rota, { itens: inscricoes });
    const corpo = (req.postDataJSON() ?? {}) as Record<string, unknown>;
    pedidos.push({ metodo: req.method(), caminho, corpo });
    if (caminho.endsWith('/referencia')) {
      const i = inscricoes[0]!;
      const de = (i['referencia'] as { nome: string } | null)?.nome ?? null;
      const para = PROFISSIONAIS.find((x) => x.id === corpo['referencia']) ?? null;
      Object.assign(i, { referencia: para, versao: Number(i['versao']) + 1 });
      (i['historico'] as unknown[]).push({
        ocorridoEm: `${HOJE}T12:00:00`,
        operacao: 'alteracao',
        evento: 'referencia',
        estado: (i['estado'] as { descricao: string }).descricao,
        referenciaDe: de,
        referenciaPara: para?.nome ?? null,
        usuario: 'SINT.MEDICO',
      });
      return json(rota, { id: 500 });
    }
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
      (i['historico'] as unknown[]).push({
        ocorridoEm: `${HOJE}T11:00:00`,
        operacao: 'alteracao',
        evento: 'estado',
        estado: e.descricao,
        referenciaDe: null,
        referenciaPara: null,
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
          evento: 'inscricao',
          estado: 'INCLUIDO SINTETICO',
          referenciaDe: null,
          referenciaPara: null,
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
      rotulo: /^PROFISSIONAL SINTETICO$/,
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
    await expect(insc.locator('tr[data-evento="estado"]')).toContainText('Mudança de estado');
    await expect(insc.getByRole('table')).toContainText('ALTA SINTETICA');
  });

  test('ficha: troca e tira o profissional de referência, a linha do tempo diz de quem para quem; suspender pede motivo', async ({
    page,
  }) => {
    const pedidos: Pedido[] = [];
    await entrar(page, 'SINT.MEDICO');
    await simular(page, pedidos, { inscricoes: [inscricaoViva()] });
    await page.goto(`/cadastros/pacientes/${PACIENTE}`);
    const sec = page.getByTestId('linhas-cuidado-paciente');
    const insc = sec.locator('article[data-inscricao="HAS"]');
    await expect(insc).toContainText('PROFISSIONAL SINTETICO');

    // Troca: busca pela rota do programa e grava só a versão e o novo profissional.
    await insc.getByRole('button', { name: 'Trocar o profissional' }).click();
    const troca = insc.getByTestId('trocar-referencia');
    const confirmar = troca.getByRole('button', { name: 'Trocar o profissional' });
    await expect(confirmar).toBeDisabled();
    await troca.getByLabel('Buscar profissional (3 letras ou mais)').fill('DOIS');
    await escolher(troca.getByRole('combobox', { name: 'Profissional de referência' }), {
      rotulo: 'PROFISSIONAL SINTETICO DOIS',
    });
    await confirmar.click();
    await expect(sec.getByRole('status')).toContainText('Profissional de referência trocado.');
    expect(pedidos[0]).toEqual({
      metodo: 'PUT',
      caminho: `pacientes/${PACIENTE}/linhas-cuidado/500/referencia`,
      corpo: { versao: 1, referencia: 88 },
    });
    await insc.getByText('Linha do tempo').click();
    await expect(insc.locator('tr[data-evento="referencia"]')).toContainText(
      'Troca do profissional de referência de PROFISSIONAL SINTETICO para PROFISSIONAL SINTETICO DOIS',
    );

    // Tirar o profissional (o programa sintético não exige no servidor simulado): referência nula.
    await insc.getByRole('button', { name: 'Trocar o profissional' }).click();
    await insc.getByTestId('trocar-referencia').getByRole('button', { name: 'Tirar o profissional' }).click();
    await expect(sec.getByRole('status')).toContainText('Profissional de referência trocado.');
    expect(pedidos[1]).toEqual({
      metodo: 'PUT',
      caminho: `pacientes/${PACIENTE}/linhas-cuidado/500/referencia`,
      corpo: { versao: 2, referencia: null },
    });
    await expect(insc.locator('tr[data-evento="referencia"]').last()).toContainText(
      'de PROFISSIONAL SINTETICO DOIS para Sem profissional de referência',
    );

    // Suspender pede o motivo antes de liberar.
    await insc.getByRole('button', { name: 'Mudar o estado' }).click();
    const mud = insc.getByTestId('mudar-estado');
    await escolher(mud.getByRole('combobox', { name: 'Novo estado' }), { rotulo: /SUSPENSO SINTETICO/ });
    const gravar = mud.getByRole('button', { name: 'Gravar a mudança' });
    await expect(mud.getByText('Escreva o motivo (ao menos 5 letras).')).toBeVisible();
    await expect(gravar).toBeDisabled();
    await mud.getByLabel('Motivo').fill('Viagem prolongada');
    await gravar.click();
    await expect(sec.getByRole('status')).toContainText('Estado alterado.');
    expect(pedidos[2]).toEqual({
      metodo: 'POST',
      caminho: `pacientes/${PACIENTE}/linhas-cuidado/500/estado`,
      corpo: { versao: 3, estado: 3, data: HOJE, motivo: 'Viagem prolongada' },
    });
    await expect(insc).toHaveAttribute('data-encerrada', 'nao');
    await expect(insc).toContainText('SUSPENSO SINTETICO');
  });

  test('ficha: a falha da busca do profissional aparece, não vira lista vazia', async ({ page }) => {
    await entrar(page, 'SINT.MEDICO');
    await simular(page, [], { buscaStatus: 403 });
    await page.goto(`/cadastros/pacientes/${PACIENTE}`);
    const form = page.getByTestId('linhas-cuidado-paciente').getByTestId('nova-inscricao');
    await form.getByLabel('Buscar profissional (3 letras ou mais)').fill('PROF');
    await expect(form.getByRole('alert')).toContainText('Não foi possível buscar os profissionais');
    await expect(form.getByRole('combobox', { name: 'Profissional de referência' })).toHaveCount(0);
  });

  test('catálogo: novo programa com validação na hora, alteração com o código travado e inativação sem apagar', async ({
    page,
  }) => {
    const pedidos: Pedido[] = [];
    await entrar(page, 'SINT.ADMIN');
    await simular(page, pedidos);
    await page.goto('/cadastros/pacientes/linhas-cuidado');
    const tela = page.getByTestId('tela-linhas-cuidado');
    await tela.getByRole('button', { name: 'Novo programa' }).click();
    const ficha = tela.getByTestId('lc-ficha');
    const gravar = ficha.getByRole('button', { name: 'Gravar o programa' });
    await expect(ficha.getByText('Informe o código.')).toBeVisible();
    await expect(ficha.getByText('Informe a descrição (ao menos 3 letras).')).toBeVisible();
    await expect(gravar).toBeDisabled();
    await ficha.getByLabel('Código', { exact: true }).fill('GES');
    await ficha.getByLabel('Descrição').fill('PROGRAMA SINTETICO GESTANTE');
    await ficha.getByLabel('Exige profissional de referência').check();
    await expect(ficha.getByText('Informe o código.')).toHaveCount(0);
    await gravar.click();
    await expect(tela.getByRole('status')).toContainText('Programa gravado.');
    expect(pedidos[0]).toMatchObject({
      metodo: 'POST',
      caminho: 'linhas-cuidado',
      corpo: {
        codigo: 'GES',
        descricao: 'PROGRAMA SINTETICO GESTANTE',
        exigeReferencia: true,
        faixaEtaria: null,
      },
    });

    // Alterar: o código fica travado; inativar manda ativo=false com a versão lida (nunca apaga).
    await tela.locator('tr[data-programa="PUE"]').getByRole('button', { name: 'Alterar' }).click();
    const alt = tela.getByTestId('lc-ficha');
    await expect(alt.getByLabel('Código', { exact: true })).toBeDisabled();
    await expect(alt.getByLabel('Código', { exact: true })).toHaveValue('PUE');
    await alt.getByLabel('Ativo', { exact: true }).uncheck();
    await alt.getByRole('button', { name: 'Gravar o programa' }).click();
    await expect(tela.getByRole('status')).toContainText('Programa gravado.');
    expect(pedidos[1]).toMatchObject({
      metodo: 'PUT',
      caminho: 'linhas-cuidado/11',
      corpo: { versao: 1, ativo: false, codigo: 'PUE', descricao: 'PROGRAMA SINTETICO PUERICULTURA' },
    });
    expect(pedidos.some((x) => x.metodo === 'DELETE')).toBe(false);
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
