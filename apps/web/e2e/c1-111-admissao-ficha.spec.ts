// E2E @C1-111 (ficha docs/fases/fichas/F78-07-financeiro-pessoas.md, 07-RH linha 163): a admissão pela ficha rápida
// (/pessoas/colaboradores/admitir) pede, além do CPF, do cargo e da lotação, o que o contrato de trabalho exige no
// eSocial: nascimento, sexo, grau de instrução, categoria do trabalhador, natureza do vínculo e salário. A regra do
// domínio (`conferirFichaAdmissao`) confere na hora: idade abaixo da mínima segura a revisão com o aviso; corrigida, o
// resumo mostra a ficha e o pedido leva todos os campos. As respostas são simuladas pelo Playwright com massa
// SINTÉTICA (CPF de dígito calculado sobre base inventada). O efeito no banco (colaborador, vínculo, histórico, reuso
// do CPF da rede e a versão nova do dependente) está em apps/api/src/modulos/pessoas/porta-propria.int.spec.ts.
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

function dv11(base: string, pesos: readonly number[]): number {
  let s = 0;
  pesos.forEach((p, i) => (s += Number(base[i]) * p));
  const r = s % 11;
  return r < 2 ? 0 : 11 - r;
}
function cpf(base9: string): string {
  const d1 = dv11(base9, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = dv11(`${base9}${d1}`, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base9}${d1}${d2}`;
}
const br = (d: Date) =>
  `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

async function simular(page: Page, pedidos: Record<string, unknown>[]): Promise<void> {
  const hoje = new Date().toISOString().slice(0, 10);
  await page.route('**/api/pessoas/apoio', (r) =>
    json(r, {
      hoje,
      centrosCusto: [{ codigo: 41, rotulo: 'Enfermagem sintética' }],
      unidades: [],
      tiposRescisao: [],
      sexos: [
        { codigo: 1, rotulo: 'Feminino' },
        { codigo: 2, rotulo: 'Masculino' },
      ],
      categoriasTrabalhador: [{ codigo: 101, rotulo: '101 - Empregado geral' }],
      tiposVinculoTrabalho: [{ codigo: 10101, rotulo: 'Empregatício: celetista (prazo indeterminado)' }],
      janelaAlertaDias: 30,
      gravacao: { ligada: true, motivo: null },
      acoes: { admitir: true, desligar: true, motivo: null },
    }),
  );
  await page.route('**/api/pessoas/admissao/previa', (r) =>
    json(r, { profissional: null, usuarios: [], vinculosAtivos: [], ambigua: false }),
  );
  await page.route('**/api/pessoas/colaboradores', async (r) => {
    if (r.request().method() !== 'POST') return r.fallback();
    pedidos.push(r.request().postDataJSON() as Record<string, unknown>);
    return json(r, { id: 9101, mensagem: 'Colaborador admitido.' });
  });
}

test.describe('admissão pela ficha rápida com a ficha do eSocial @C1-111', () => {
  test('a regra confere na hora, o resumo mostra a ficha e o pedido leva todos os campos', async ({
    page,
  }) => {
    const pedidos: Record<string, unknown>[] = [];
    await simular(page, pedidos);
    await entrar(page, 'SINT.RH');
    await page.goto('/pessoas/colaboradores/admitir');
    await expect(page.getByTestId('tela-admissao')).toBeVisible();

    await page.getByLabel('CPF', { exact: true }).fill(cpf('907345120'));
    await page.getByTestId('consultar-cpf').click();
    await expect(page.getByTestId('previa-admissao')).toBeVisible();
    await page.getByTestId('admissao-continuar').click();

    await page.getByLabel('Nome completo').fill('ADMITIDA SINTETICA C1111');
    await page.getByLabel('Data de admissão').fill(br(new Date()));
    await page.getByLabel('Data de admissão').press('Tab');
    await page.getByLabel('Cargo', { exact: true }).fill('Técnico de enfermagem');
    await page.getByLabel('Carga semanal (horas)').fill('36');
    await escolher(page.getByTestId('admissao-centro-custo'), { rotulo: 'Enfermagem sintética' });
    await page.getByLabel('Matrícula').fill('C1111-01');
    await escolher(page.getByTestId('admissao-sexo'), { rotulo: 'Feminino' });
    await escolher(page.getByTestId('admissao-grau-instrucao'), { rotulo: /^07 - / });
    await escolher(page.getByTestId('admissao-categoria'), { rotulo: /^101 - / });
    await escolher(page.getByTestId('admissao-natureza'), { rotulo: /^Empregatício/ });
    await page.getByLabel('Salário-base (R$)').fill('3.850,75');

    // Nascimento que dá menos de 14 anos na admissão: o aviso aparece e a revisão fica segurada.
    const menor = new Date();
    menor.setFullYear(menor.getFullYear() - 10);
    await page.getByLabel('Data de nascimento').fill(br(menor));
    await page.getByLabel('Data de nascimento').press('Tab');
    await expect(page.getByTestId('admissao-ficha-erro')).toContainText('ao menos 14 anos');
    await expect(page.getByTestId('admissao-revisar')).toBeDisabled();

    await page.getByLabel('Data de nascimento').fill('20/08/1995');
    await page.getByLabel('Data de nascimento').press('Tab');
    await expect(page.getByTestId('admissao-ficha-erro')).toHaveCount(0);
    await semViolacaoAxe(page, 'admissão: ficha do eSocial');
    await page.getByTestId('admissao-revisar').click();

    const resumo = page.getByTestId('admissao-resumo');
    await expect(resumo).toContainText('20/08/1995');
    await expect(resumo).toContainText('101 - Empregado geral');
    await expect(resumo).toContainText('Empregatício: celetista');
    await expect(page.getByTestId('admissao-resumo-salario')).toContainText('3.850,75');
    await page.getByTestId('admissao-gravar').click();
    await expect(page.getByTestId('admissao-concluida')).toBeVisible();

    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]).toMatchObject({
      nascimento: '1995-08-20',
      sexo: 1,
      grauInstrucao: '07',
      categoria: 101,
      tipoVinculoTrabalho: 10101,
      salario: 3850.75,
      matricula: 'C1111-01',
      cargaSemanalHoras: 36,
    });
  });
});
