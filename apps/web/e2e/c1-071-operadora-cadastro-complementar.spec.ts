// E2E @C1-071 (08-SGO linha 93, F7): o cadastro complementar de cada operadora da instalação. O administrador liga a
// operadora e os beneficiários para as pessoas do teste → o gestor da operadora cadastra duas operadoras sintéticas pela
// API → na tela "Beneficiários, planos e contratos" escolhe a segunda no combo Operadora e abre a aba "Responsáveis,
// setores e parâmetros" → o aviso lista os papéis únicos sem titular → registra a auditoria independente pelo CNPJ (a
// pessoa achada aparece antes de gravar) → cria o setor de autorização e o de regulação abaixo dele; o setor com e-mail
// inválido mostra o problema na hora e não deixa gravar → altera o prazo da cobertura parcial temporária: 30 meses é
// recusado na hora (faixa 1 a 24); 18 grava e a linha deixa de ser "padrão" → a primeira operadora continua sem nada
// (escopo por operadora) → recolher; axe sem violação séria em cada estado. Sessão real sobre a fonte sintética de dev;
// documentos SINTÉTICOS. Nenhuma saída externa (vigiarExternas).
import { expect, test, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const PESSOAS = ['SINT.OPERADORA'];
const CHAVES = ['operadora', 'operadora.beneficiarios'];

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}
async function csrf(page: Page): Promise<string> {
  return (await page.context().cookies()).find((c) => c.name === 'sgh_csrf')?.value ?? '';
}
const cabecalhos = async (page: Page, k: string) => ({
  'x-csrf': await csrf(page),
  'idempotency-key': `e2e-c1-071-${k}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
});
async function chave(page: Page, nome: string, ligar: boolean): Promise<void> {
  const r = await page.request.post('/api/administracao/liberacao', {
    headers: await cabecalhos(page, `${nome}-${ligar}`),
    data: {
      chave: nome,
      tipo: 'recurso',
      escopo: 'pessoa',
      valores: PESSOAS,
      ligar,
      justificativa: 'Cadastro complementar sintético (E2E do C1-071)',
      senha: SENHA,
    },
  });
  expect(r.status(), await r.text()).toBe(200);
}
async function prerequisito(page: Page, recurso: string, tipo: string): Promise<void> {
  const r = await page.request.put('/api/administracao/liberacao/prerequisitos', {
    headers: await cabecalhos(page, `pre-${recurso}`),
    data: {
      recurso,
      tipo,
      situacao: 'cumprido',
      validade: '2099-12-31',
      evidencia: 'pré-requisito sintético do E2E',
      senha: SENHA,
    },
  });
  expect(r.status(), await r.text()).toBe(200);
}
function dv11(base: string, pesos: readonly number[]): number {
  let s = 0;
  pesos.forEach((p, i) => (s += Number(base[i]) * p));
  const r = s % 11;
  return r < 2 ? 0 : 11 - r;
}
const cnpj = (b12: string) => {
  const d1 = dv11(b12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${b12}${d1}${dv11(`${b12}${d1}`, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])}`;
};
async function empresa(page: Page, registro: string, doc: string, nome: string): Promise<number> {
  const r = await page.request.post('/api/operadora/empresas', {
    headers: await cabecalhos(page, `empresa-${registro}`),
    data: { registroAns: registro, cnpj: doc, razaoSocial: nome, modalidade: 'medicinaGrupo' },
  });
  expect(r.status(), await r.text()).toBe(201);
  return ((await r.json()) as { id: number }).id;
}

test.describe('operadora: responsáveis, setores e parâmetros por operadora @C1-071', () => {
  test.setTimeout(240_000);

  test('ligar → duas operadoras → responsável pelo CNPJ → setores com hierarquia e validação na hora → parâmetro por faixa → escopo por operadora → recolher; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const sufixo = String(Date.now() % 100_000).padStart(5, '0');
    const docB = cnpj(`8${sufixo}000002`.slice(0, 12));

    await entrar(page, 'SINT.ADMIN');
    await prerequisito(page, 'operadora', 'credenciamento');
    for (const c of CHAVES) await chave(page, c, true);

    try {
      await entrar(page, 'SINT.OPERADORA');
      const opA = await empresa(
        page,
        `8${sufixo}`,
        cnpj(`8${sufixo}000001`.slice(0, 12)),
        `Operadora A ${sufixo}`,
      );
      const opB = await empresa(page, `7${sufixo}`, docB, `Operadora B ${sufixo}`);
      expect(opB).not.toBe(opA);

      await page.goto('/operadora/beneficiarios');
      await escolher(page.getByTestId('operadora-ativa'), { rotulo: new RegExp(`\\(7${sufixo}\\)`) });
      await page.getByTestId('aba-complementar').click({ timeout: 30_000 });
      const compl = page.getByTestId('operadora-complementar');
      await expect(compl).toBeVisible();
      await expect(compl.getByTestId('compl-papeis-sem-titular')).toContainText('Responsável técnico');
      await semViolacaoAxe(page, 'operadora: cadastro complementar');

      // Responsável: auditoria independente achada pelo CNPJ da própria empresa sintética.
      await compl.getByTestId('compl-resp-novo').click();
      const fr = compl.getByTestId('form-responsavel');
      await escolher(fr.getByTestId('compl-resp-papel'), { rotulo: 'Auditoria independente' });
      await fr.getByLabel('CPF ou CNPJ').fill(docB);
      await fr.getByTestId('compl-resp-buscar').click();
      await expect(fr.getByTestId('compl-resp-pessoa')).toContainText(`Operadora B ${sufixo}`);
      await semViolacaoAxe(page, 'operadora: cadastro complementar');
      await fr.getByTestId('compl-resp-gravar').click();
      await expect(compl.getByTestId('compl-mensagem')).toContainText('Responsável registrado');
      await expect(compl.getByTestId('tabela-responsaveis')).toContainText('Auditoria independente');
      await expect(compl.getByTestId('tabela-responsaveis')).toContainText(`Operadora B ${sufixo}`);

      // Setores: o e-mail inválido trava o botão na hora; a regulação fica abaixo da autorização.
      await compl.getByTestId('compl-dep-novo').click();
      let fd = compl.getByTestId('form-departamento');
      await fd.getByLabel('Código').fill('AUT');
      await fd.getByLabel('Descrição').fill('Autorização');
      await escolher(fd.getByTestId('compl-dep-tipo'), { rotulo: 'Autorização' });
      await fd.getByLabel('E-mail do setor').fill('sem-arroba');
      await expect(fd.getByTestId('compl-dep-problemas')).toContainText('E-mail do setor inválido');
      await expect(fd.getByTestId('compl-dep-gravar').locator('button')).toBeDisabled();
      await fd.getByLabel('E-mail do setor').fill('autorizacao@exemplo.invalid');
      await fd.getByTestId('compl-dep-gravar').click();
      await expect(compl.getByTestId('compl-mensagem')).toContainText('Setor gravado');
      await compl.getByTestId('compl-dep-novo').click();
      fd = compl.getByTestId('form-departamento');
      await fd.getByLabel('Código').fill('REG');
      await fd.getByLabel('Descrição').fill('Regulação');
      await escolher(fd.getByTestId('compl-dep-tipo'), { rotulo: 'Regulação' });
      await escolher(fd.getByTestId('compl-dep-superior'), { rotulo: /Autorização \(AUT\)/ });
      await fd.getByTestId('compl-dep-gravar').click();
      await expect(compl.getByTestId('departamento-REG')).toContainText('Autorização');
      await semViolacaoAxe(page, 'operadora: cadastro complementar');

      // Parâmetro: fora da faixa recusado na hora; 18 grava e deixa de ser o padrão.
      await compl.getByTestId('compl-par-alterar-prazo_cpt_meses').click();
      const fp = compl.getByTestId('form-parametro');
      await fp.getByLabel('Novo valor').fill('30');
      await expect(fp.getByTestId('compl-par-problema')).toContainText('de 1 a 24');
      await fp.getByLabel('Novo valor').fill('18');
      await fp.getByLabel('Justificativa').fill('Revisão sintética do contrato (E2E)');
      await fp.getByTestId('compl-par-gravar').click();
      await expect(compl.getByTestId('compl-mensagem')).toContainText('valor anterior fica no histórico');
      await expect(compl.getByTestId('parametro-prazo_cpt_meses')).toContainText('18');
      await expect(compl.getByTestId('parametro-prazo_cpt_meses')).not.toContainText('padrão');

      // Escopo por operadora: o que foi gravado na B não aparece na A (pela API e pela tela).
      const resp = await page.request.get(`/api/operadora/complementar/empresas/${opA}/departamentos`);
      expect(resp.status(), await resp.text()).toBe(200);
      expect(await resp.json()).toEqual([]);
      await escolher(page.getByTestId('operadora-ativa'), { rotulo: new RegExp(`\\(8${sufixo}\\)`) });
      await expect(page.getByTestId('compl-departamentos')).toContainText('Nenhum setor cadastrado');
    } finally {
      await entrar(page, 'SINT.ADMIN');
      for (const c of [...CHAVES].reverse()) await chave(page, c, false);
    }
    expect(externas).toEqual([]);
  });
});
