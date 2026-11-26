// E2E @C3-007 (08-INTG L128 (31), ficha F3.9): o link da elegibilidade a partir do atendimento do paciente. Na lista dos
// atendimentos do dia, a linha do paciente cadastrado leva à visão de elegibilidade dele
// (`/faturamento/elegibilidade?paciente=`), que abre já com as coberturas; a linha sem cadastro (paciente não
// identificado, sem id) não mostra o link. As rotas exigem o banco próprio e o E2E roda com a fonte sintética: as
// respostas da API são simuladas pelo Playwright com massa SINTÉTICA. A gravação da consulta já tem contrato de efeito
// em apps/api/src/modulos/tiss/elegibilidade-propria.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';

const SENHA = 'Sintetico#2026';
const PACIENTE = 7401;

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

function atendimento(reg: number, paciente: number | null) {
  return {
    reg,
    cabecalho: String(9000 + reg),
    data: '2026-11-26',
    hora: '08:00',
    tipo: null,
    tipoLegado: 1,
    tipoRotulo: 'Ambulatorial',
    requisicao: false,
    paciente: { id: paciente, prontuario: 500 + reg, nome: `Paciente sintético ${reg}` },
    convenio: { codigo: 12, nome: 'Operadora sintética' },
    profissional: { crm: 1, nome: 'Médico sintético' },
    especialidade: { codigo: 1, nome: 'Clínica sintética' },
    unidade: 1,
    carater: null,
    senha: null,
    desfecho: null,
    abertoNoNovo: true,
  };
}

test.describe('Elegibilidade a partir do atendimento @C3-007 @fase3', () => {
  test.setTimeout(180_000);
  test('a linha do paciente cadastrado leva à elegibilidade dele; sem cadastro, sem link; axe', async ({
    page,
  }) => {
    await page.route('**/api/atendimento/dia**', (rota) =>
      json(rota, {
        data: '2026-11-26',
        itens: [atendimento(1, PACIENTE), atendimento(2, null)],
        cortada: false,
        requisicoes: 0,
      }),
    );
    await page.route('**/api/tiss/elegibilidade/pacientes/**', (rota) =>
      json(rota, {
        coberturas: [
          {
            id: 31,
            fontePagadora: 'Operadora sintética',
            carteira: '0000111122223333',
            validade: '2027-12-31',
            ultimaElegibilidadeEm: null,
            ultimaAprovada: null,
          },
        ],
        consultas: [],
      }),
    );

    await entrar(page, 'SINT.GUICHE');
    await page.goto('/recepcao/atendimento');
    await expect(page.getByTestId('atendimento-1')).toBeVisible();
    await expect(page.getByTestId('atd-elegibilidade-2')).toHaveCount(0);
    const link = page.getByTestId('atd-elegibilidade-1');
    await expect(link).toHaveAccessibleName('Elegibilidade do paciente do atendimento 1 na operadora');
    await semViolacaoAxe(page, '/recepcao/atendimento (link da elegibilidade)');

    await link.click();
    await expect(page).toHaveURL(new RegExp(`/faturamento/elegibilidade\\?paciente=${PACIENTE}$`));
    await expect(page.getByTestId('elegibilidade')).toBeVisible();
    await expect(page.getByTestId('eleg-cobertura-31').getByTestId('eleg-ultima')).toHaveText(
      'Nunca consultada',
    );
  });
});
