// E2E @C1-122 (F3.7, 06-FAT linha 24): as guias do convênio no hospital pelo caminho da tela
// (/faturamento/guias-convenio). O faturista abre a tela pelo menu (Faturamento > Convênios > Guias do convênio); a fila
// mostra a guia por paciente (prontuário, convênio, situação, pendências, responsável) e a fila do centro cirúrgico só
// as guias de cirurgia, pela data prevista. No painel da guia: assume a guia; abre a pendência (sem motivo, barrada na
// hora) e a guia vai a "pendente"; a resposta da operadora fica barrada enquanto há pendência aberta e sem senha;
// resolvida a pendência, a guia volta à situação anterior; a resposta autorizada passa pela validação dos dias (mais
// dias que os pedidos, barrado na hora) e sai com o corpo certo; o anexo recusa o tipo que não é PDF, JPEG ou PNG e sai
// em base64 com o tipo próprio do corpo com anexos. A linha do tempo mostra cada passo. As rotas exigem o banco próprio e
// o E2E roda com a fonte sintética: as respostas são simuladas pelo Playwright com massa SINTÉTICA, no contrato do
// servidor. O efeito no banco (guia_pendencia, guia_anexo, guia_historico) está no contrato de efeito
// apps/api/src/modulos/faturamento/auditoria-tramite-propria.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher, esperarSemSelectNativo } from './combos.js';

const SENHA = 'Sintetico#2026';
const F = '/api/faturamento';

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

type Pendencia = Record<string, unknown> & { id: number; situacao: string };
type Evento = Record<string, unknown>;

/** O estado simulado do servidor: a guia escolhida, a fila e as gravações (corpo e tipo do corpo). */
function simular(page: Page) {
  const st = {
    situacao: 'solicitada',
    responsavel: null as string | null,
    senha: null as string | null,
    pendencias: [] as Pendencia[],
    anexos: [] as Record<string, unknown>[],
    historico: [
      {
        id: 1,
        evento: 'inclusao',
        de: null,
        para: 'solicitada',
        observacao: null,
        usuario: 'SINT.TISS',
        em: '2026-11-20T10:00:00.000Z',
      },
    ] as Evento[],
    filas: [] as string[],
    corpos: [] as { rota: string; tipo: string; corpo: Record<string, unknown> }[],
  };
  const abertas = () => st.pendencias.filter((p) => p.situacao === 'aberta').length;
  const naFila = (id: number, numero: string, cirurgia: boolean) => ({
    id,
    numero,
    numeroOperadora: null,
    tipo: cirurgia ? 'sp_sadt' : 'internacao',
    situacao: id === 70 ? st.situacao : 'solicitada',
    fonte: 'CONVENIO SINTETICO C1122',
    paciente: cirurgia ? 'PACIENTE SINTETICO CIRURGIA' : 'PACIENTE SINTETICO C1122',
    prontuario: cirurgia ? 9102 : 9101,
    atendimentoId: null,
    contaId: id === 70 ? 5501 : null,
    solicitadaEm: '2026-11-20T10:00:00.000Z',
    temSenha: id === 70 && st.senha !== null,
    validadeSenha: null,
    cirurgia,
    cirurgiaPrevista: cirurgia ? '2030-01-15T08:00:00.000Z' : null,
    prazoPendencia: null,
    responsavel: id === 70 ? st.responsavel : null,
    pendencias: id === 70 ? abertas() : 0,
  });
  const evento = (e: Evento) =>
    st.historico.push({
      id: st.historico.length + 1,
      usuario: 'SINT.TISS',
      em: '2026-11-25T10:00:00.000Z',
      ...e,
    });
  return {
    st,
    ligar: () =>
      page.route(`**${F}/guia**`, (rota) => {
        const req = rota.request();
        const url = new URL(req.url());
        const caminho = url.pathname.replace(F, '');
        if (req.method() === 'GET') {
          if (caminho === '/guias-convenio') {
            st.filas.push(url.search);
            const cirurgia = url.searchParams.get('cirurgia') === '1';
            return json(
              rota,
              cirurgia
                ? [naFila(71, 'G-C1122-2', true)]
                : [naFila(70, 'G-C1122-1', false), naFila(71, 'G-C1122-2', true)],
            );
          }
          if (caminho === '/guias/70/acompanhamento')
            return json(rota, {
              id: 70,
              numero: 'G-C1122-1',
              numeroOperadora: null,
              tipo: 'internacao',
              situacao: st.situacao,
              fonte: 'CONVENIO SINTETICO C1122',
              senha: st.senha,
              validadeSenha: null,
              solicitadaEm: '2026-11-20T10:00:00.000Z',
              autorizadaEm: null,
              diasSolicitados: 5,
              diasAutorizados: null,
              motivoNegacao: null,
              responsavelId: st.responsavel ? 9001 : null,
              responsavel: st.responsavel,
              pendencias: st.pendencias,
              anexos: st.anexos,
              historico: st.historico,
              motivosPendencia: [
                { id: 5, codigo: 'LAU', descricao: 'Falta laudo sintético' },
                { id: 6, codigo: 'OPM', descricao: 'Falta orçamento sintético' },
              ],
            });
          return rota.fallback();
        }
        const corpo = (req.postDataJSON() ?? {}) as Record<string, unknown>;
        st.corpos.push({ rota: caminho, tipo: req.headers()['content-type'] ?? '', corpo });
        if (caminho === '/guias/70/responsavel') {
          st.responsavel = 'SINT.TISS';
          evento({ evento: 'responsavel', de: null, para: null, observacao: 'SINT.TISS' });
          return json(rota, { id: 70 });
        }
        if (caminho === '/guias/70/pendencias') {
          st.pendencias.push({
            id: 801,
            sequencia: 1,
            situacao: 'aberta',
            motivo: 'Falta laudo sintético',
            descricao: (corpo['descricao'] as string | null) ?? null,
            abertaEm: '2026-11-25T10:00:00.000Z',
            prazoEm: (corpo['prazo'] as string | null) ?? null,
            responsavel: null,
            resolvidaEm: null,
            resolvidoPor: null,
            solucao: null,
          });
          evento({ evento: 'pendencia_aberta', de: st.situacao, para: 'pendente', observacao: null });
          st.situacao = 'pendente';
          return json(rota, { id: 801 }, 201);
        }
        if (caminho === '/guias/pendencias/801/resolucao') {
          const p = st.pendencias[0]!;
          Object.assign(p, {
            situacao: 'resolvida',
            resolvidaEm: '2026-11-25T11:00:00.000Z',
            resolvidoPor: 'SINT.TISS',
            solucao: corpo['solucao'],
          });
          // A pendência resolvida devolve a guia à situação de antes da pendência.
          evento({ evento: 'pendencia_resolvida', de: 'pendente', para: 'solicitada', observacao: null });
          st.situacao = 'solicitada';
          return json(rota, { id: 801 });
        }
        if (caminho === '/guias/70/resposta') {
          evento({
            evento: 'resposta',
            de: st.situacao,
            para: corpo['resposta'] as string,
            observacao: null,
          });
          st.situacao = corpo['resposta'] as string;
          st.senha = (corpo['senha'] as string | null) ?? null;
          return json(rota, { id: 70 });
        }
        if (caminho === '/guias/70/anexos') {
          st.anexos.push({
            id: 901,
            sequencia: 1,
            tipo: corpo['tipoDocumento'],
            descricao: corpo['descricao'] ?? null,
            nome: corpo['nomeOriginal'],
            tamanho: 12,
            em: '2026-11-25T12:00:00.000Z',
          });
          evento({ evento: 'anexo', de: null, para: null, observacao: corpo['nomeOriginal'] as string });
          return json(rota, { id: 901 }, 201);
        }
        return json(rota, { codigo: 'nao-simulado' }, 500);
      }),
  };
}

test.describe('@C1-122 Guias do convênio no hospital @fase3', () => {
  test.describe.configure({ mode: 'serial', timeout: 240_000 });

  test('pelo menu: Faturamento > Convênios > Guias do convênio; fila por paciente e fila do centro cirúrgico; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const s = simular(page);
    await s.ligar();
    await entrar(page, 'SINT.TISS');
    const menu = page.getByRole('navigation', { name: 'Menu principal' });
    await menu.locator('#menu-buscar').fill('Guias do convênio');
    await menu.getByRole('link', { name: 'Guias do convênio' }).click();
    await expect(page).toHaveURL(/\/faturamento\/guias-convenio$/);
    const tela = page.getByTestId('guias-convenio');
    await expect(tela).toBeVisible();
    await esperarSemSelectNativo(tela);

    // A fila por paciente: nome, prontuário, convênio, situação, pendências e responsável.
    const linha = page.getByTestId('gc-G-C1122-1');
    await expect(linha).toContainText('PACIENTE SINTETICO C1122');
    await expect(linha).toContainText('prontuário 9101');
    await expect(linha).toContainText('CONVENIO SINTETICO C1122');
    await expect(linha).toContainText('Solicitada');
    await expect(linha).toContainText('Sem responsável');
    await expect(page.getByTestId('gc-conta-G-C1122-1')).toHaveAttribute('href', '/faturamento/contas/5501');
    await expect(page.getByTestId('gc-G-C1122-2')).toContainText('Cirurgia');

    // A fila do centro cirúrgico: só as guias de cirurgia, pela data prevista.
    await page.getByTestId('gc-fila-cirurgia').check();
    await expect(page.getByTestId('gc-G-C1122-1')).toHaveCount(0);
    await expect(page.getByTestId('gc-G-C1122-2')).toBeVisible();
    await expect(tela.locator('thead')).toContainText('Cirurgia prevista');
    expect(s.st.filas.at(-1)).toContain('cirurgia=1');

    // O filtro da situação vai à consulta.
    await page.getByTestId('gc-fila-cirurgia').uncheck();
    await escolher(page.getByTestId('gc-situacao'), { rotulo: 'Pendente' });
    await expect.poll(() => s.st.filas.at(-1)).toContain('situacao=pendente');
    await semViolacaoAxe(page, '/faturamento/guias-convenio');
    expect(externas).toEqual([]);
  });

  test('assume, abre e resolve a pendência, registra a resposta e anexa, com a validação na hora; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const s = simular(page);
    await s.ligar();
    await entrar(page, 'SINT.TISS');
    await page.goto('/faturamento/guias-convenio');
    await page.getByTestId('gc-G-C1122-1').click();
    const painel = page.getByTestId('gc-painel');
    await expect(painel).toContainText('G-C1122-1');
    await esperarSemSelectNativo(painel);

    // Assumir a guia: o responsável aparece no painel e na fila.
    await page.getByTestId('gc-assumir').click();
    await expect(page.getByRole('status')).toHaveText('Gravado.');
    expect(s.st.corpos[0]).toEqual({
      rota: '/guias/70/responsavel',
      tipo: expect.stringContaining('application/json'),
      corpo: { responsavelId: null },
    });
    await expect(painel).toContainText('Responsável: SINT.TISS');
    await expect(page.getByTestId('gc-G-C1122-1')).toContainText('SINT.TISS');

    // Pendência: sem motivo, barrada na hora; com o motivo e o prazo, a guia vai a "pendente".
    const formPend = page.getByTestId('gc-form-pendencia');
    await expect(formPend).toContainText('Escolha o motivo da pendência.');
    await expect(page.getByTestId('gc-abrir-pendencia')).toBeDisabled();
    await escolher(page.getByTestId('gc-motivo'), { rotulo: 'Falta laudo sintético' });
    await formPend.getByPlaceholder('Motivo').fill('Laudo do exame de imagem');
    await formPend.getByLabel('Prazo').fill('2030-01-10T10:00');
    await expect(formPend).not.toContainText('Escolha o motivo da pendência.');
    await page.getByTestId('gc-abrir-pendencia').click();
    await expect(page.getByRole('status')).toHaveText('Gravado.');
    expect(s.st.corpos[1]).toMatchObject({
      rota: '/guias/70/pendencias',
      corpo: {
        motivoId: 5,
        descricao: 'Laudo do exame de imagem',
        prazo: expect.stringMatching(/^2030-01-10T/),
      },
    });
    await expect(painel.locator('h2')).toContainText('Pendente');
    await expect(page.getByTestId('gc-pend-1')).toContainText('Falta laudo sintético');
    await expect(page.getByTestId('gc-G-C1122-1')).toContainText('Pendente');

    // Resposta: com pendência aberta e sem senha, barrada na hora.
    const formResp = page.getByTestId('gc-form-resposta');
    await expect(formResp).toContainText('Resolva as pendências abertas da guia');
    await expect(formResp).toContainText('Informe a senha dada pela operadora.');
    await expect(page.getByTestId('gc-responder')).toBeDisabled();

    // Resolver a pendência: sem solução não sai; resolvida, a guia volta à situação de antes.
    const pend = page.getByTestId('gc-pend-1');
    await expect(pend.getByRole('button', { name: 'Resolver' })).toBeDisabled();
    await pend.getByPlaceholder('Solução').fill('Laudo recebido do setor de imagem');
    await pend.getByRole('button', { name: 'Resolver' }).click();
    await expect(page.getByRole('status')).toHaveText('Gravado.');
    expect(s.st.corpos[2]).toMatchObject({
      rota: '/guias/pendencias/801/resolucao',
      corpo: { solucao: 'Laudo recebido do setor de imagem' },
    });
    await expect(pend).toContainText('Laudo recebido do setor de imagem (SINT.TISS)');
    await expect(painel.locator('h2')).toContainText('Solicitada');
    await expect(formResp).not.toContainText('Resolva as pendências abertas da guia');

    // Resposta autorizada: mais dias que os pedidos, barrada; com senha e 5 dias, sai com o corpo certo.
    await page.getByTestId('gc-senha').fill('SENHA-C1122');
    await formResp.getByLabel(/Dias autorizados/).fill('6');
    await expect(formResp).toContainText('Os dias autorizados passam dos solicitados.');
    await expect(page.getByTestId('gc-responder')).toBeDisabled();
    await formResp.getByLabel(/Dias autorizados/).fill('5');
    await expect(formResp.getByRole('alert')).toHaveCount(0);
    expect(s.st.corpos).toHaveLength(3);
    await semViolacaoAxe(page, '/faturamento/guias-convenio (resposta)');
    await page.getByTestId('gc-responder').click();
    await expect(page.getByRole('status')).toHaveText('Gravado.');
    expect(s.st.corpos[3]).toEqual({
      rota: '/guias/70/resposta',
      tipo: expect.stringContaining('application/json'),
      corpo: {
        resposta: 'autorizada',
        numeroOperadora: null,
        senha: 'SENHA-C1122',
        validadeSenha: null,
        diasAutorizados: 5,
        motivoNegacao: null,
      },
    });
    await expect(painel.locator('h2')).toContainText('Autorizada');
    await expect(painel).toContainText('Senha: SENHA-C1122');

    // Anexo: texto é recusado na hora; o PDF sai em base64 com o tipo próprio do corpo com anexos.
    const formAnexo = page.getByTestId('gc-form-anexo');
    const arquivo = formAnexo.locator('input[type="file"]');
    await arquivo.setInputFiles({
      name: 'nota.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('sintetico'),
    });
    await expect(formAnexo).toContainText('Anexe PDF, JPEG ou PNG.');
    await expect(formAnexo.getByRole('button', { name: 'Anexar' })).toBeDisabled();
    const pdf = Buffer.from('%PDF-1.4 sintetico');
    await arquivo.setInputFiles({ name: 'laudo-sintetico.pdf', mimeType: 'application/pdf', buffer: pdf });
    await expect(formAnexo.getByRole('alert')).toHaveCount(0);
    await formAnexo.getByRole('button', { name: 'Anexar' }).click();
    await expect(page.getByRole('status')).toHaveText('Gravado.');
    expect(s.st.corpos[4]).toEqual({
      rota: '/guias/70/anexos',
      tipo: 'application/vnd.sgh.anexos+json',
      corpo: {
        tipoDocumento: 'laudo',
        descricao: null,
        nomeOriginal: 'laudo-sintetico.pdf',
        tipoMime: 'application/pdf',
        conteudo: pdf.toString('base64'),
      },
    });
    await expect(painel).toContainText('Laudo · laudo-sintetico.pdf');

    // A linha do tempo mostra cada passo, com a volta da pendência à situação anterior.
    const historico = page.getByTestId('gc-historico');
    await expect(historico.locator('li')).toHaveCount(6);
    await expect(historico).toContainText('Pendência aberta · Solicitada → Pendente');
    await expect(historico).toContainText('Pendência resolvida · Pendente → Solicitada');
    await expect(historico).toContainText('Resposta da operadora · Solicitada → Autorizada');
    await expect(historico).toContainText('Anexo incluído');
    await semViolacaoAxe(page, '/faturamento/guias-convenio (painel)');
    expect(externas).toEqual([]);
  });
});
