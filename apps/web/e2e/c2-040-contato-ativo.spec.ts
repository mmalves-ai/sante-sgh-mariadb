// E2E @C2-040 (F8, 02-REC linha 39): contato ativo com o paciente antes da consulta pelo caminho da tela
// (`/agenda/consultas/contato-ativo`). A central vê a fila (quem disse "não" à mensagem em primeiro, com o destaque),
// abre o registro na própria linha, vê na hora o que vai acontecer (sem resultado, recusa; "desistiu", cancela e
// devolve a vaga), grava e a fila se atualiza; o histórico do paciente abre na mesma tela. O contato ativo só existe no
// banco do cliente (na fonte sintética a API responde 503): as respostas são simuladas pelo Playwright com massa
// SINTÉTICA, no contrato do servidor. O efeito no banco está em apps/api/src/modulos/agenda/contato-ativo.int.spec.ts.
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

const json = (rota: Route, corpo: unknown, status = 200) =>
  rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });

const RESULTADOS = [
  {
    id: 1,
    codigo: 'confirmou',
    descricao: 'Paciente confirmou a consulta',
    sucesso: true,
    encerraTentativas: true,
    efeitoMarcacao: 'confirmar',
  },
  {
    id: 2,
    codigo: 'desistiu',
    descricao: 'Paciente desistiu da consulta',
    sucesso: true,
    encerraTentativas: true,
    efeitoMarcacao: 'cancelar',
  },
  {
    id: 3,
    codigo: 'nao_atendeu',
    descricao: 'Não atendeu',
    sucesso: false,
    encerraTentativas: false,
    efeitoMarcacao: null,
  },
];
const item = (marcacao: number, negativa: boolean, horas: number) => ({
  marcacao,
  paciente: 9400 + marcacao,
  nome: `PACIENTE SINTETICO C2040 ${marcacao}`,
  prontuario: 90000 + marcacao,
  telefone: '11999990040',
  agenda: 'AGENDA SINTETICA C2040',
  inicioEm: new Date(Date.now() + horas * 3_600_000).toISOString(),
  respostaNegativa: negativa,
  tentativas: 0,
  contatoPendente: null,
  programadoPara: null,
});

function simular(page: Page) {
  const st = {
    itens: [item(2, true, 50), item(1, false, 30)],
    corpos: [] as Record<string, unknown>[],
  };
  void page.route('**/api/agenda/contato-ativo**', (r) => {
    const url = new URL(r.request().url());
    if (url.pathname.endsWith('/resultados')) return json(r, RESULTADOS);
    if (url.pathname.includes('/pacientes/'))
      return json(r, [
        {
          id: 9601,
          paciente: 9402,
          nome: 'PACIENTE SINTETICO C2040 2',
          marcacao: 2,
          canal: 'telefone',
          motivo: 'confirmacao_marcacao',
          situacao: 'realizado',
          resultado: 'Paciente desistiu da consulta',
          programadoPara: null,
          contatoEm: new Date().toISOString(),
          informante: null,
          descricao: 'Viaja na data (sintético).',
          anterior: null,
        },
      ]);
    if (r.request().method() === 'GET') return json(r, { itens: st.itens, programados: [] });
    const corpo = r.request().postDataJSON() as Record<string, unknown>;
    st.corpos.push(corpo);
    st.itens = st.itens.filter((i) => i.marcacao !== corpo['marcacao']);
    return json(r, {
      ok: true,
      resultado: { contato: 9601, efeito: 'cancelar', novaTentativa: null, alertas: [] },
      repetida: false,
      mensagem: 'Contato registrado.',
    });
  });
  return st;
}

test.describe('@C2-040 contato ativo antes da consulta', () => {
  test('a resposta negativa vem primeiro e a desistência cancela com a previsão na hora', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const st = simular(page);
    await entrar(page, 'sint.gestor.agenda');
    await page.goto('/agenda/consultas/contato-ativo');
    const linhas = page.getByTestId('contato-fila').locator('tbody tr');
    await expect(linhas.first()).toHaveAttribute('data-testid', 'contato-item-2');
    await expect(page.getByTestId('contato-negativa-2')).toHaveText('Disse não na mensagem');

    // Registro na linha: sem resultado, recusa na hora e o botão fica desabilitado.
    await page.getByTestId('contato-registrar-2').click();
    await expect(page.getByTestId('contato-recusa')).toContainText('resultado');
    await expect(page.getByTestId('contato-gravar')).toBeDisabled();
    await escolher(page.getByTestId('contato-edicao').getByLabel('Resultado'), 'desistiu');
    await expect(page.getByTestId('contato-previsao')).toContainText('cancelada pela desistência');
    await page.getByTestId('contato-descricao').locator('input, textarea').first().fill('Viaja na data.');
    await page.getByTestId('contato-gravar').click();
    await expect(page.getByTestId('contato-mensagem')).toHaveText('Contato registrado.');
    expect(st.corpos[0]).toMatchObject({
      paciente: 9402,
      marcacao: 2,
      canal: 'telefone',
      motivo: 'confirmacao_marcacao',
      resultado: 'desistiu',
      descricao: 'Viaja na data.',
    });
    await expect(page.getByTestId('contato-item-2')).toHaveCount(0);

    // Visão por paciente: o histórico abre na mesma tela.
    await page.getByTestId('contato-historico-1').click();
    await expect(page.getByTestId('contato-historico')).toContainText('Paciente desistiu da consulta');

    await semViolacaoAxe(page, 'contato ativo antes da consulta');
    expect(externas).toEqual([]);
  });
});
