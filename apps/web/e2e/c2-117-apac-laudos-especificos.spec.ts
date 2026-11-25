// C2-117 (06-SUS linha 56): laudo complementar (oncologia, saúde auditiva, medicamento especializado, odontologia) e
// sessões da APAC, pelo caminho da tela. As rotas /api/sus/apac-complementos exigem o banco próprio, e o E2E roda com
// a fonte sintética (sem núcleo); por isso as respostas da lista das APACs e dos complementos são simuladas pelo
// Playwright com massa SINTÉTICA. O que se prova é a tela: a aba exigida pelo procedimento abre sozinha com o aviso
// de pendência; a conferência na hora trava o botão até a finalidade e o esquema serem escolhidos; o laudo vai com
// {versao, dados}; na APAC autorizada de terapia renal a sessão é registrada com a modalidade e aparece na lista com
// a ação de cancelar. O efeito no banco (laudos, retirada marcada, sessão que abre a APAC da competência) está no
// contrato de efeito apps/api/src/modulos/sus/apac-complementos-propria.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const FATURISTA = 'SINT.FATURISTA.APAC';

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

const ONCO = 9101;
const RENAL = 9102;

const apac = (id: number, extra: Record<string, unknown>) => ({
  id,
  situacao: 'solicitada',
  prontuario: 99000 + id,
  registro: 70000 + id,
  atendimento: null,
  procedimento: '0304020000',
  procedimentoNome: 'PROCEDIMENTO SINTETICO',
  cidPrincipal: 'C500',
  cidSecundario: null,
  cidAssociado: null,
  solicitante: 'SINT-CHAVE',
  solicitanteNome: 'MEDICO SINTETICO',
  solicitanteCrm: 1234,
  dataSolicitacao: '2026-11-10',
  justificativa: 'Justificativa sintetica do laudo',
  laudoEspecifico: 'nenhum',
  nefrologia: null,
  numero: null,
  tipo: null,
  dataAutorizacao: null,
  competenciaInicial: null,
  competenciaFinal: null,
  ultimaCompetencia: null,
  motivoSaida: null,
  dataEncerramento: null,
  justificativaSituacao: null,
  registradaPor: FATURISTA,
  registradaEm: '2026-11-10T10:00:00.000Z',
  alteradaPor: null,
  alteradaEm: null,
  versao: '0000000001',
  ...extra,
});

const opcoes = {
  finalidade_tratamento: [
    { id: 1, codigo: '1', descricao: 'FINALIDADE SINTETICA A' },
    { id: 2, codigo: '2', descricao: 'FINALIDADE SINTETICA B' },
  ],
  medicamento_antineoplasico: [{ id: 11, codigo: '011', descricao: 'ESQUEMA SINTETICO' }],
};

test.describe('C2-117 laudo complementar e sessões da APAC @C2-117', () => {
  test('aba exigida com pendência, conferência na hora, gravar laudo e registrar sessão', async ({
    page,
  }) => {
    const laudosGravados: { tipo: string; corpo: Record<string, unknown> }[] = [];
    const sessoesGravadas: Record<string, unknown>[] = [];
    let oncologia: Record<string, unknown> | null = null;
    let versaoOnco = 3;
    const sessoes: Record<string, unknown>[] = [];

    await page.route(
      (u) => u.pathname === '/api/sus/competencias',
      (r) =>
        json(r, {
          competencias: [],
          instrumentos: [{ instrumento: 'apac', liberado: true }],
          cihaFonteDoEnvio: false,
          escopoParcial: false,
          hoje: '2026-11-25',
        }),
    );
    await page.route(
      (u) => u.pathname === '/api/sus/apac',
      (r) =>
        r.request().method() === 'GET'
          ? json(r, {
              itens: [
                apac(ONCO, {}),
                apac(RENAL, {
                  situacao: 'autorizada',
                  procedimento: '0305010107',
                  cidPrincipal: 'N180',
                  laudoEspecifico: 'nefrologia',
                  numero: '3326200000011',
                  tipo: 'inicial',
                  dataAutorizacao: '2026-11-12',
                  competenciaInicial: '2026-11',
                  competenciaFinal: '2027-01',
                  ultimaCompetencia: '2026-11',
                }),
              ],
              total: 2,
              porSituacao: { solicitada: 1, autorizada: 1 },
            })
          : r.fallback(),
    );
    await page.route(
      (u) => u.pathname === '/api/sus/apac/dominios',
      (r) =>
        json(r, {
          caracteristicaTratamento: [],
          contraindicacaoTransplante: [],
          situacaoTransplante: [],
          acessoVascular: [],
        }),
    );
    await page.route(
      (u) => u.pathname === '/api/sus/arquivos',
      (r) => json(r, []),
    );
    await page.route(
      (u) => u.pathname.startsWith('/api/sus/apac-complementos/'),
      async (r) => {
        const caminho = new URL(r.request().url()).pathname.replace('/api/sus/apac-complementos/', '');
        const metodo = r.request().method();
        if (metodo === 'GET' && caminho === String(ONCO))
          return json(r, {
            id: ONCO,
            versao: versaoOnco,
            situacao: 'solicitada',
            procedimento: '0304020000',
            familia: 'oncologia',
            exigido: 'oncologia',
            pendente: oncologia === null,
            validadeInicio: null,
            validadeFim: null,
            laudos: { oncologia, auditiva: null, medicamento: null, odontologia: null },
            sessoes: [],
            opcoes,
          });
        if (metodo === 'GET' && caminho === String(RENAL))
          return json(r, {
            id: RENAL,
            versao: 5,
            situacao: 'autorizada',
            procedimento: '0305010107',
            familia: 'nefrologia',
            exigido: 'nefrologia',
            pendente: false,
            validadeInicio: '2026-11-01',
            validadeFim: '2027-01-31',
            laudos: { oncologia: null, auditiva: null, medicamento: null, odontologia: null },
            sessoes,
            opcoes: {},
          });
        if (metodo === 'POST' && caminho === `${ONCO}/laudos/oncologia`) {
          const corpo = r.request().postDataJSON() as Record<string, unknown>;
          laudosGravados.push({ tipo: 'oncologia', corpo });
          oncologia = corpo['dados'] as Record<string, unknown>;
          versaoOnco += 1;
          return json(r, { id: ONCO });
        }
        if (metodo === 'POST' && caminho === `${RENAL}/sessoes`) {
          const corpo = r.request().postDataJSON() as Record<string, unknown>;
          sessoesGravadas.push(corpo);
          sessoes.push({
            id: 501,
            data: corpo['data'],
            procedimento: '0305010107',
            quantidade: corpo['quantidade'],
            comparecimento: corpo['comparecimento'],
            modalidade: corpo['modalidade'],
            kits: corpo['kits'],
            competencia: '2026-11',
            tipoApac: 'inicial',
            aberta: true,
            registradaPor: FATURISTA,
            versao: 1,
          });
          return json(r, { id: 501 });
        }
        return json(r, { erro: 'rota não simulada' }, 404);
      },
    );

    await entrar(page, FATURISTA);
    await page.goto('/faturamento/sus/apac');
    await expect(page.getByTestId('tela-apac')).toBeVisible();
    await expect(page.getByTestId('apac-desligada')).toHaveCount(0);

    // 1) A APAC de oncologia: a aba exigida abre sozinha, com o aviso de pendência.
    await page.getByTestId(`botao-ver-${ONCO}`).click();
    await expect(page.getByTestId('apac-detalhe')).toBeVisible();
    const painel = page.getByTestId('apac-complementos');
    await expect(painel.getByTestId('apac-complementos-pendente')).toContainText('0304020000');
    await expect(painel.getByTestId('apac-aba-oncologia')).toHaveAttribute('aria-selected', 'true');
    const form = painel.getByTestId('apac-form-oncologia');
    await expect(form).toBeVisible();
    await semViolacaoAxe(page, 'C2-117 laudo de oncologia pendente');

    // 2) Conferência na hora: sem finalidade e sem esquema da quimioterapia, o botão fica travado.
    await expect(painel.getByTestId('apac-complementos-avisos')).toBeVisible();
    await expect(painel.getByTestId('botao-gravar-laudo-especifico')).toBeDisabled();
    await escolher(form.getByTestId('onco-finalidade'), { indice: 1 });
    await escolher(form.getByTestId('onco-esquema'), { indice: 1 });
    await expect(painel.getByTestId('apac-complementos-avisos')).toHaveCount(0);
    await painel.getByTestId('botao-gravar-laudo-especifico').click();
    await expect(painel.getByTestId('apac-complementos-mensagem')).toContainText(
      'Laudo complementar gravado',
    );
    expect(laudosGravados).toHaveLength(1);
    const enviado = laudosGravados[0]!.corpo;
    expect(enviado['versao']).toBe(3);
    expect(enviado['dados']).toMatchObject({ tipoTratamento: 'quimioterapia', finalidade: 1, esquema: 11 });
    // Relido: a pendência some e a aba marca o laudo preenchido; a retirada fica disponível.
    await expect(painel.getByTestId('apac-complementos-pendente')).toHaveCount(0);
    await expect(painel.getByTestId('apac-aba-oncologia')).toContainText('preenchido');
    await expect(painel.getByTestId('botao-retirar-laudo-especifico')).toBeVisible();
    await semViolacaoAxe(page, 'C2-117 laudo de oncologia gravado');

    // 3) A APAC renal autorizada: abre na aba das sessões; a modalidade é exigida para quem compareceu.
    await page.getByTestId(`botao-ver-${RENAL}`).click();
    await expect(painel.getByTestId('apac-aba-sessoes')).toHaveAttribute('aria-selected', 'true');
    const sessoesArea = painel.getByTestId('apac-sessoes');
    await expect(sessoesArea).toContainText('Nenhuma sessão registrada.');
    const formSessao = sessoesArea.getByTestId('apac-sessao-form');
    await expect(formSessao.getByTestId('botao-registrar-sessao')).toBeDisabled();
    const data = formSessao.getByTestId('sessao-data').locator('input');
    await data.fill('20/11/2026');
    await data.blur();
    await expect(formSessao.getByTestId('botao-registrar-sessao')).toBeDisabled();
    await escolher(formSessao.getByTestId('sessao-modalidade'), 'hemodialise');
    await expect(formSessao.getByTestId('botao-registrar-sessao')).toBeEnabled();
    await semViolacaoAxe(page, 'C2-117 sessão a registrar');
    await formSessao.getByTestId('botao-registrar-sessao').click();
    await expect(painel.getByTestId('apac-complementos-mensagem')).toContainText('Sessão registrada');
    expect(sessoesGravadas).toHaveLength(1);
    expect(sessoesGravadas[0]).toMatchObject({
      versao: 5,
      data: '2026-11-20',
      comparecimento: 'compareceu',
      modalidade: 'hemodialise',
      quantidade: 1,
    });
    const linha = sessoesArea.getByTestId('apac-sessao-linha');
    await expect(linha).toHaveCount(1);
    await expect(linha).toContainText('2026-11 (inicial)');
    await expect(linha.getByTestId('botao-cancelar-sessao')).toBeVisible();
    await semViolacaoAxe(page, 'C2-117 sessão registrada');
  });
});
