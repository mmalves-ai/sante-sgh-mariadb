// E2E @C2-064 (03-PEP L94): equipe assistencial do atendimento ligada ao resto do hospital, no que a fonte sintética
// permite. A equipe, a equipe padrão e a fila moram só no banco do cliente; para provar o fluxo da tela (aplicar a
// equipe padrão sugerida ao setor num clique, ver quem ficou de fora e por quê, salvar a equipe atual como padrão e a
// fila "pendências que chegam a mim" no painel do profissional) a API é simulada por page.route com dados SINTÉTICOS.
// O que fica no banco (vínculo pela equipe da conta, fila pelos destinatários, alta encerrando e cancelamento reabrindo
// a equipe na mesma transação, equipe padrão gravada, aplicada e desativada) é provado no contrato de efeito
// apps/api/src/modulos/pep/equipe-assistencial-fim-padrao-propria.int.spec.ts e a regra em
// packages/dominio-pep/src/equipe-painel/equipe-fim-padrao.spec.ts. Sessão real sobre a fonte sintética de dev.
import { expect, test, type Page, type Route } from '@playwright/test';
import { escolher } from './combos.js';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';

const SENHA = 'Sintetico#2026';
const ATENDIMENTO = 7001;
const PACIENTE = 1001;

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const funcoes = [
  { id: 1, descricao: 'Médico assistente', categoria: 'medica', responsavelPrincipal: true },
  { id: 2, descricao: 'Enfermeiro de referência', categoria: 'enfermagem', responsavelPrincipal: false },
];
const padrao = {
  id: 9,
  nome: 'Equipe da UTI sintética',
  setor: 3,
  setorNome: 'UTI sintética',
  especialidade: null,
  sugerir: true,
  ativo: true,
  versao: 1,
  membros: [
    {
      sequencia: 1,
      funcao: 1,
      funcaoDescricao: 'Médico assistente',
      profissional: 501,
      profissionalNome: 'Médico Sintético',
      responsavel: true,
    },
    {
      sequencia: 2,
      funcao: 2,
      funcaoDescricao: 'Enfermeiro de referência',
      profissional: 502,
      profissionalNome: 'Enfermeira Sintética',
      responsavel: false,
    },
    {
      sequencia: 3,
      funcao: 2,
      funcaoDescricao: 'Enfermeiro de referência',
      profissional: null,
      profissionalNome: null,
      responsavel: false,
    },
  ],
};
const membro = (id: number, profissional: number, funcao: number, nome: string, responsavel: boolean) => ({
  id,
  profissional,
  profissionalNome: nome,
  funcao,
  funcaoDescricao: funcoes.find((f) => f.id === funcao)!.descricao,
  responsavelPrincipal: responsavel,
  recebeNotificacao: true,
  inicio: '2026-11-25T08:00:00',
  fim: null,
  motivoSaida: null,
});

test.describe('Equipe assistencial: equipe padrão e fila de pendências @C2-064 @fase3', () => {
  test.setTimeout(120_000);
  test('aplica a equipe padrão sugerida, mostra os ignorados, salva como padrão e lista a fila; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const estado = { aplicada: false };
    const posts: { url: string; corpo: unknown }[] = [];
    await entrar(page, 'SINT.ADMIN');
    await page.route('**/api/pep/equipe/**', async (route: Route) => {
      const req = route.request();
      const url = req.url();
      if (req.method() === 'GET' && url.includes('/equipe/funcoes'))
        return route.fulfill({ json: { itens: funcoes } });
      if (req.method() === 'GET' && url.includes('/equipe/padroes'))
        return route.fulfill({ json: { itens: [padrao], sugeridos: [padrao.id] } });
      if (req.method() === 'GET' && url.includes('/equipe/minha-fila'))
        return route.fulfill({
          json: {
            itens: [
              {
                equipe: 40,
                atendimento: ATENDIMENTO,
                numero: 'A-7001',
                paciente: PACIENTE,
                pacienteNome: 'Paciente Sintético',
                responsavel: true,
              },
            ],
          },
        });
      if (req.method() === 'GET' && url.includes(`/equipe/atendimento/${ATENDIMENTO}`))
        return route.fulfill({
          json: {
            equipe: estado.aplicada ? 40 : null,
            paciente: PACIENTE,
            membros: estado.aplicada
              ? [
                  membro(81, 501, 1, 'Médico Sintético', true),
                  membro(82, 502, 2, 'Enfermeira Sintética', false),
                ]
              : [],
          },
        });
      posts.push({ url, corpo: req.postDataJSON() });
      if (url.endsWith(`/equipe/atendimento/${ATENDIMENTO}/padrao/${padrao.id}`)) {
        estado.aplicada = true;
        return route.fulfill({
          json: {
            equipe: 40,
            incluidos: 2,
            ignorados: [{ sequencia: 3, codigo: 'funcao-sem-profissional' }],
          },
        });
      }
      if (url.endsWith('/equipe/padroes')) return route.fulfill({ json: { id: 10 } });
      return route.fulfill({ json: { id: 1 } });
    });
    await page.route('**/api/pep/prontuario-setor**', (route: Route) =>
      route.fulfill({ json: { itens: [], setores: [{ id: 3, nome: 'UTI sintética' }] } }),
    );

    await page.goto(`/pep/equipe/${ATENDIMENTO}`);
    await expect(page.getByTestId('equipe-assistencial')).toBeVisible();
    // A sugerida ao setor já vem escolhida: um clique aplica.
    await expect(page.getByTestId('equipe-padrao-escolha')).toContainText('sugerida');
    await page.getByTestId('equipe-padrao-aplicar').click();
    await expect(page.getByTestId('equipe-padrao-resultado')).toContainText('2 profissional');
    await expect(page.getByTestId('equipe-padrao-resultado')).toContainText('sem profissional nomeado');
    await expect(page.getByTestId('equipe-membro-501')).toContainText('(responsável)');
    await expect(page.getByTestId('equipe-membro-502')).toBeVisible();

    // Salvar a equipe atual como padrão: nome e setor validados na hora.
    await page.getByTestId('equipe-padrao-salvar').click();
    await expect(page.getByTestId('equipe-padrao-confirmar')).toBeDisabled();
    await page.getByTestId('equipe-padrao-nome').fill('Equipe do plantão sintético');
    await escolher(page.getByTestId('equipe-padrao-setor'), '3');
    await expect(page.getByTestId('equipe-padrao-confirmar')).toBeEnabled();
    await page.getByTestId('equipe-padrao-confirmar').click();
    await expect(page.getByTestId('equipe-aviso-encerrada')).toContainText('Equipe padrão salva');
    const salvo = posts.find((p) => p.url.endsWith('/equipe/padroes'))!.corpo as Record<string, unknown>;
    expect(salvo['setor']).toBe(3);
    expect((salvo['membros'] as unknown[]).length).toBe(2);
    await semViolacaoAxe(page, 'equipe assistencial C2-064');

    // A fila do painel do profissional: o paciente cujas pendências chegam à conta, com o atalho para a equipe.
    await page.goto('/pep/pacientes');
    await expect(page.getByTestId(`fila-equipe-${ATENDIMENTO}`)).toContainText('responsável principal');
    await page
      .getByTestId(`fila-equipe-${ATENDIMENTO}`)
      .getByRole('link', { name: 'Equipe assistencial' })
      .click();
    await expect(page).toHaveURL(new RegExp(`/pep/equipe/${ATENDIMENTO}$`));
    expect(externas).toEqual([]);
  });
});
