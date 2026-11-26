// E2E @C2-090 (F8, 03-PEP linha 111): na ficha da oncologia (`/pep/especialidades/oncologia/:reg`), o novo ciclo que
// abre o tratamento pede o tumor do paciente e a intenção (combos); a aba "Acompanhamento e reações" abre o
// acompanhamento do tumor, atualiza para recidiva (a data e o tumor que voltou são cobrados na hora) e registra a
// reação do tratamento com grau CTCAE (grau 3 sem conduta trava o gravar). O acompanhamento e o registro só existem no
// banco do cliente (na fonte sintética a API responde 503): as respostas são simuladas pelo Playwright com massa
// SINTÉTICA, no contrato do servidor. O efeito no banco está em
// apps/api/src/modulos/especialidades/registro-oncologico.int.spec.ts (C2-090).
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const REG = 950102;
const json = (rota: Route, corpo: unknown, status = 200) =>
  rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const HOJE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const [ANO, MES, DIA] = HOJE.split('-');
const TUMOR = {
  id: 9001,
  versao: 1,
  cid: 'C50.4',
  cidDescricao: 'C2090 NEOPLASIA SINTETICA',
  topografia: 'C50.4',
  topografiaDescricao: 'QUADRANTE SINTETICO',
  morfologia: null,
  morfologiaDescricao: null,
  lateralidade: 'esquerda',
  diagnosticadoEm: '2026-01-10',
  baseDiagnostica: 'histologia_primario',
  ecog: 1,
  situacao: 'ativo',
  estadiamentos: [] as unknown[],
  metastases: [] as unknown[],
};
const ACOMP = {
  id: 9011,
  versao: 1,
  tumor: 9001,
  classificacao: 'em_tratamento',
  classificadoEm: HOJE,
  situacaoTumor: 'presente',
  resposta: null,
  primeiroTratamentoEm: null,
  recidivaEm: null,
  obitoEm: null,
  eventos: [{ tipo: 'classificacao', operacao: 'inclusao', ocorridoEm: `${HOJE}T08:00`, observacao: null }],
};

test.describe('@C2-090 oncologia: abertura do tratamento, acompanhamento do tumor e reações', () => {
  test('diagnóstico e intenção no novo ciclo; acompanhamento com recidiva e reação grau 3 com conduta; axe', async ({
    page,
  }) => {
    vigiarExternas(page);
    const estado = { acompanhamentos: [] as unknown[], reacoes: [] as unknown[] };
    const enviados: Record<string, unknown> = {};
    const E = '**/api/especialidades/oncologia';
    await page.route(`${E}/internacoes/${REG}/registro`, (r) =>
      json(r, { hoje: HOJE, tumores: [TUMOR], planos: [] }),
    );
    // O novo ciclo só abre com um protocolo publicado: a leitura real da internação na fonte sintética recebe um
    // protocolo SINTÉTICO ofertável, para o spec não depender de outro que tenha publicado antes.
    await page.route(`${E}/internacoes/${REG}`, async (r) => {
      const real = (await (await r.fetch()).json()) as { protocolos: unknown[] };
      return json(r, {
        ...real,
        protocolos: [
          ...real.protocolos,
          {
            id: 9031,
            codigo: 'C2090-ONC',
            versao: 1,
            nome: 'Protocolo SINTETICO C2-090',
            tipo: { codigo: 3, nome: 'Quimioterapia' },
            intervaloDias: 21,
            ciclos: 6,
            farmacos: [],
            indicacao: null,
            referencia: 'Protocolo institucional SINTETICO',
            hash: 'c2090',
            vigente: true,
            integro: true,
            por: 'SINT.ESPECIALISTA',
            em: `${HOJE}T07:00`,
            revogada: false,
            inativo: false,
            ofertavel: true,
            eventos: [],
          },
        ],
      });
    });
    await page.route(`${E}/registro/cadastros`, (r) =>
      json(r, {
        intencoes: [
          { id: 1, codigo: 'curativa', descricao: 'Curativa' },
          { id: 2, codigo: 'paliativa', descricao: 'Paliativa' },
        ],
        regioes: [],
        aparelhos: [],
        estadios: [],
        fisicos: [],
      }),
    );
    await page.route(`${E}/internacoes/${REG}/acompanhamento`, (r) => json(r, estado));
    await page.route(`${E}/registro/acompanhamentos?**`, (r) => {
      const b = r.request().postDataJSON() as Record<string, unknown>;
      if (b['acompanhamento'] === null) {
        enviados['abertura'] = b;
        estado.acompanhamentos = [ACOMP];
        return json(
          r,
          {
            ok: true,
            id: 9011,
            versao: 1,
            tipo: 'classificacao',
            mensagem: 'Acompanhamento registrado: a mudança fica na linha do tempo.',
          },
          201,
        );
      }
      enviados['recidiva'] = b;
      estado.acompanhamentos = [
        {
          ...ACOMP,
          versao: 2,
          classificacao: 'recidiva',
          situacaoTumor: 'metastase',
          recidivaEm: HOJE,
          eventos: [
            { tipo: 'recidiva', operacao: 'alteracao', ocorridoEm: `${HOJE}T09:00`, observacao: null },
            ...ACOMP.eventos,
          ],
        },
      ];
      return json(
        r,
        {
          ok: true,
          id: 9011,
          versao: 2,
          tipo: 'recidiva',
          mensagem: 'Acompanhamento registrado: a mudança fica na linha do tempo.',
        },
        201,
      );
    });
    await page.route(`${E}/registro/reacoes?**`, (r) => {
      enviados['reacao'] = r.request().postDataJSON();
      estado.reacoes = [
        {
          id: 9021,
          acompanhamento: 9011,
          tratamento: null,
          ciclo: null,
          avaliadoEm: `${HOJE}T00:00`,
          categoria: 'hematologica',
          descricao: 'Neutropenia febril',
          grau: 3,
          evolucao: 'nova',
          conduta: 'Antibiótico de amplo espectro',
          doseAjustada: false,
          tratamentoSuspenso: false,
        },
      ];
      return json(r, { ok: true, id: 9021, mensagem: 'Reação registrada.' }, 201);
    });

    await entrar(page, 'SINT.ESPECIALISTA');
    await page.goto(`/pep/especialidades/oncologia/${REG}`);

    // Novo ciclo: o ciclo que abre o tratamento pede o tumor e a intenção (combos com o cadastro).
    await page.getByRole('tab', { name: 'Novo ciclo' }).click();
    await page.locator('#ciclo-numero').fill('1');
    await expect(page.getByTestId('ciclo-diagnostico')).toBeVisible();
    await escolher(page.getByTestId('ciclo-diagnostico'), { rotulo: /C50\.4/ });
    await escolher(page.getByTestId('ciclo-intencao'), { rotulo: 'Curativa' });

    // Acompanhamento: abre com o tumor já sugerido; a recidiva sem data e com tumor presente é recusada na hora.
    await page.getByRole('tab', { name: 'Acompanhamento e reações' }).click();
    await expect(page.getByTestId('onco-acompanhamento')).toContainText('Nenhum acompanhamento aberto');
    await page.getByTestId('onco-acomp-abrir').click();
    await page.getByTestId('onco-acomp-gravar').click();
    await expect(page.getByTestId('onco-acomp-9011')).toContainText('Em tratamento');
    expect(enviados['abertura']).toMatchObject({ tumor: 9001, classificacao: 'em_tratamento', versao: null });

    await page.getByTestId('onco-acomp-atualizar-9011').click();
    await escolher(page.getByTestId('onco-acomp-classificacao'), { rotulo: 'Recidiva' });
    await expect(page.getByTestId('onco-acomp-erros')).toContainText('Informe a data da recidiva');
    await expect(page.getByTestId('onco-acomp-gravar')).toBeDisabled();
    await page.getByTestId('onco-acomp-recidiva').getByRole('textbox').fill(`${DIA}/${MES}/${ANO}`);
    await escolher(page.getByTestId('onco-acomp-situacao'), { rotulo: 'Metástase' });
    await expect(page.getByTestId('onco-acomp-erros')).toHaveCount(0);
    await page.getByTestId('onco-acomp-gravar').click();
    await expect(page.getByTestId('onco-acomp-9011')).toContainText('Recidiva');
    expect(enviados['recidiva']).toMatchObject({
      acompanhamento: 9011,
      versao: 1,
      classificacao: 'recidiva',
      situacaoTumor: 'metastase',
      recidivaEm: HOJE,
    });

    // Reação grau 3: a conduta é cobrada na hora; com ela, grava.
    await page.getByTestId('onco-reacao-nova-9011').click();
    await page.getByTestId('onco-reacao-descricao').getByRole('textbox').fill('Neutropenia febril');
    await escolher(page.getByTestId('onco-reacao-grau'), { rotulo: '3' });
    await expect(page.getByTestId('onco-reacao-erros')).toContainText('registre a conduta');
    await page.getByTestId('onco-reacao-conduta').getByRole('textbox').fill('Antibiótico de amplo espectro');
    await expect(page.getByTestId('onco-reacao-erros')).toHaveCount(0);
    await page.getByTestId('onco-reacao-gravar').click();
    await expect(page.getByTestId('onco-reacao-9021')).toContainText('Grave');
    expect(enviados['reacao']).toMatchObject({ acompanhamento: 9011, grau: 3, categoria: 'hematologica' });

    await semViolacaoAxe(page, `/pep/especialidades/oncologia/${REG} (acompanhamento e reações)`);
  });
});
