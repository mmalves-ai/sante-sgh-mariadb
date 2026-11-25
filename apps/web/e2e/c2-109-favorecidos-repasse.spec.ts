// E2E @C2-109 (06-FAT linha 46): favorecidos do repasse e prestadores terceiros, na fonte SINTÉTICA (porta em memória
// dos favorecidos, sem banco do cliente). O analista escolhe o médico pela busca, inclui o favorecido de 60% para o
// próprio médico e o de 40% para a empresa dele (com a conta do fornecedor da empresa), vê a soma por fonte conferida na
// hora (41% passaria de 100%: aviso e botão desligado), grava o enquadramento tributário do fornecedor da empresa na
// própria linha (alíquota fora de 0 a 100 recusada na hora) e vê a retenção, encerra a vigência da empresa (nada
// apagado: a linha continua no histórico com o fim), inclui um prestador terceiro e a conta PIX dele; axe sem violação
// séria.
//
// Isolamento entre execuções no mesmo servidor: o início dos favorecidos e do enquadramento é o dia seguinte ao maior
// início já gravado para o médico (lido pela API), então a execução seguinte substitui a anterior em vez de bater no
// conflito de vigência, que continua recusado pela porta; o código e o CNPJ do prestador são gerados por execução.
// Sem a fonte sintética (banco próprio), o teste é pulado com o motivo. Massa sintética: nenhum dado de pessoa.
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const R = '/api/repasse';
const MEDICO = 'MEDICO SINTETICO B';

interface Favorecido {
  id: number;
  tipo: string;
  inicio: string;
  fim: string | null;
  retencoes: { situacao: string; vigentes: { aliquotaIss: number | null }[] };
}

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const diaSeguinte = (d: string): string => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
};

/** Um CNPJ válido e sintético, diferente a cada execução (dígitos verificadores calculados). */
function cnpjSintetico(semente: number): string {
  const base = `${String(semente % 1e8).padStart(8, '0')}0001`.split('').map(Number);
  const dv = (n: number[]) => {
    const pesos =
      n.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const r = n.reduce((s, x, i) => s + x * pesos[i]!, 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(base);
  const d2 = dv([...base, d1]);
  return [...base, d1, d2].join('');
}

test.describe('@C2-109 favorecidos do repasse e prestadores terceiros', () => {
  test('60% ao médico e 40% à empresa, enquadramento do fornecedor, encerrar sem apagar e prestador com conta', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.REP.ANALISTA');

    const achados = (await (
      await page.request.get(`${R}/prestadores?termo=${encodeURIComponent(MEDICO)}`)
    ).json()) as { prestador: number; registro: number }[];
    const medico = achados[0];
    test.skip(medico === undefined, 'A busca de prestadores não traz o médico sintético.');
    const sonda = await page.request.get(`${R}/favorecidos?profissional=${medico!.prestador}`);
    test.skip(sonda.status() === 503, 'Sessão sem a porta dos favorecidos.');
    expect(sonda.ok()).toBe(true);
    const antes = ((await sonda.json()) as { itens: Favorecido[] }).itens;
    const inicio = diaSeguinte(
      antes
        .map((f) => f.inicio)
        .sort()
        .at(-1) ?? '2026-01-01',
    );

    await page.goto('/repasse/favorecidos');
    await expect(page.getByTestId('tela-rep-favorecidos')).toBeVisible();
    await page.getByTestId('fv-medico-busca').fill(MEDICO);
    await page.getByTestId('fv-medico-buscar').click();
    await escolher(page.getByTestId('fv-medico'), String(medico!.registro));
    await expect(page.getByTestId('fv-novo')).toBeVisible();

    // 60% ao próprio médico (o tipo já vem no próprio).
    await page.getByTestId('fv-parte').fill('60');
    await page.getByTestId('fv-inicio').fill(inicio);
    await page.getByTestId('fv-incluir').click();
    await expect
      .poll(async () =>
        (
          (await (await page.request.get(`${R}/favorecidos?profissional=${medico!.prestador}`)).json()) as {
            itens: Favorecido[];
          }
        ).itens.some((f) => f.tipo === 'proprio_profissional' && f.inicio === inicio),
      )
      .toBe(true);

    // A empresa do médico: 41% passaria de 100% (aviso na hora, botão desligado); 40% fecha a soma da fonte.
    await escolher(page.getByTestId('fv-tipo'), 'pessoa_juridica');
    await page.getByTestId('fv-busca-alvo').fill('CLINICA');
    await page.getByTestId('fv-buscar-alvo').click();
    await escolher(page.getByTestId('fv-alvo'), { rotulo: /CLINICA SINTETICA/ });
    await escolher(page.getByTestId('fv-conta'), { rotulo: /CLINICA SINTETICA/ });
    await page.getByTestId('fv-inicio').fill(inicio);
    await page.getByTestId('fv-parte').fill('41');
    await expect(page.getByTestId('fv-soma')).toHaveAttribute('role', 'alert');
    await expect(page.getByTestId('fv-incluir')).toBeDisabled();
    await page.getByTestId('fv-parte').fill('40');
    await expect(page.getByTestId('fv-soma')).toHaveAttribute('role', 'note');
    await expect(page.getByTestId('fv-soma')).toContainText('100');
    await page.getByTestId('fv-incluir').click();

    const lidos = async () =>
      (
        (await (await page.request.get(`${R}/favorecidos?profissional=${medico!.prestador}`)).json()) as {
          itens: Favorecido[];
        }
      ).itens;
    let empresa: Favorecido | undefined;
    await expect
      .poll(async () => {
        empresa = (await lidos()).find((f) => f.tipo === 'pessoa_juridica' && f.inicio === inicio);
        return empresa?.id ?? 0;
      })
      .toBeGreaterThan(0);
    const proprio = (await lidos()).find((f) => f.tipo === 'proprio_profissional' && f.inicio === inicio);
    expect(proprio).toBeDefined();
    await semViolacaoAxe(page, '/repasse/favorecidos (favorecidos do médico)');

    // Enquadramento do fornecedor da empresa, na própria linha: alíquota fora da faixa recusada na hora.
    await page.getByTestId(`fv-enquadrar-${empresa!.id}`).click();
    await expect(page.getByTestId('fv-enquadramento')).toBeVisible();
    await escolher(page.getByTestId('fv-enq-regime'), 'lucro_presumido');
    await page.getByTestId('fv-enq-inicio').fill(inicio);
    await page.getByTestId('fv-enq-aliquota').fill('150');
    await expect(page.getByTestId('fv-enq-aliquota-erro')).toBeVisible();
    await expect(page.getByTestId('fv-enq-gravar')).toBeDisabled();
    // 0,07 tem 2 casas: vale (a regra do domínio tolera o ponto flutuante); 2,12345 passa de 4 casas.
    await page.getByTestId('fv-enq-aliquota').fill('2.12345');
    await expect(page.getByTestId('fv-enq-aliquota-erro')).toBeVisible();
    await page.getByTestId('fv-enq-aliquota').fill('0.07');
    await expect(page.getByTestId('fv-enq-aliquota-erro')).toBeHidden();
    // Decisão judicial pede o processo judicial vigente: sem ele, aviso e botão desligado.
    await escolher(page.getByTestId('fv-enq-regime'), 'decisao_judicial');
    await expect(page.getByTestId('fv-enq-processo-erro')).toBeVisible();
    await expect(page.getByTestId('fv-enq-gravar')).toBeDisabled();
    await escolher(page.getByTestId('fv-enq-processo'), '61');
    await expect(page.getByTestId('fv-enq-processo-erro')).toBeHidden();
    await escolher(page.getByTestId('fv-enq-regime'), 'lucro_presumido');
    await expect(page.getByTestId('fv-enq-processo')).toBeHidden();
    await page.getByTestId('fv-enq-aliquota').fill('2');
    await expect(page.getByTestId('fv-enq-aliquota-erro')).toBeHidden();
    await page.getByTestId('fv-enq-gravar').click();
    await expect(page.getByTestId(`fv-retencoes-${empresa!.id}`)).toContainText('ISS 2%');

    // Encerrar a empresa no próprio início: só antecipa o fim; a linha continua no histórico.
    await page.getByTestId(`fv-fim-encerrar-${empresa!.id}`).fill(inicio);
    await page.getByTestId(`fv-encerrar-${empresa!.id}`).click();
    await expect
      .poll(async () => (await lidos()).find((f) => f.id === empresa!.id)?.fim ?? null)
      .toBe(inicio);
    await expect(page.getByTestId(`fv-linha-${empresa!.id}`)).toBeVisible();

    // Prestador terceiro e a conta PIX dele (titular: o próprio prestador).
    const semente = Date.now();
    const codigo = `E2E${semente % 1e6}`;
    const cnpj = cnpjSintetico(semente);
    await page.getByTestId('pt-codigo').fill(codigo);
    await page.getByTestId('pt-nome').fill(`CLINICA TERCEIRA SINTETICA ${codigo}`);
    await escolher(page.getByTestId('pt-pessoa'), 'juridica');
    await page.getByTestId('pt-documento').fill(cnpj);
    await page.getByTestId('pt-incluir').click();
    await page.getByTestId('pt-busca').fill(codigo);
    await page.getByTestId('pt-buscar').click();
    await expect(page.getByTestId(`pt-linha-${codigo}`)).toBeVisible();
    await page.getByTestId(`pt-conta-${codigo}`).click();
    await expect(page.getByTestId('pt-conta')).toBeVisible();
    await escolher(page.getByTestId('pt-conta-tipo'), 'cnpj');
    await page.getByTestId('pt-conta-chave').fill(cnpj);
    await page.getByTestId('pt-conta-incluir').click();
    await expect(page.getByTestId('pt-contas')).toContainText(cnpj.slice(-4));
    await semViolacaoAxe(page, '/repasse/favorecidos (prestadores terceiros)');

    expect(externas).toEqual([]);
  });
});
