// E2E @M56.4 (ficha do M56, etapa 4 de 8, fatia F3; seções 7, 8 e 10 na parte da rede credenciada): a rede nasce
// desligada (a tela diz o motivo) → o administrador registra o número da operadora na ANS e liga a operadora e a rede
// para as pessoas do teste → o credenciamento abre a rede (contagens e os prestadores sintéticos), credencia um
// consultório de pessoa física (o CPF mascarado na lista, inteiro na ficha), vê a recusa da regra (pessoa física como
// hospital), altera o CNES (movimento de alteração do registro de prestadores da ANS), descredencia um hospital (sem
// substituto, a recusa; com o substituto em outro município, o aviso) e o reinclui com o contrato novo; os movimentos
// a enviar → o auditor da operadora só consulta → o administrador do hospital não abre a rede → recolher (desligar);
// axe sem violação séria em cada estado. Sessão real sobre a fonte sintética de dev, rede em MEMÓRIA (nada vai à
// cópia). Documentos SINTÉTICOS (dígitos calculados).
import { expect, test, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const PESSOAS = ['SINT.CREDENCIAMENTO', 'SINT.OPE.AUDITOR'];

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

/** Liga ou desliga a chave para as pessoas do teste (Funcionalidades por estabelecimento; reautenticação). */
async function chave(page: Page, nome: string, ligar: boolean): Promise<void> {
  const r = await page.request.post('/api/administracao/liberacao', {
    headers: { 'x-csrf': await csrf(page), 'idempotency-key': `e2e-m56-4-${nome}-${ligar}-${Date.now()}` },
    data: {
      chave: nome,
      tipo: 'recurso',
      escopo: 'pessoa',
      valores: PESSOAS,
      ligar,
      justificativa: 'Rede credenciada sintética (E2E da etapa 4)',
      senha: SENHA,
    },
  });
  expect(r.status(), await r.text()).toBe(200);
}

async function registroAns(page: Page, situacao: 'cumprido' | 'pendente'): Promise<void> {
  const r = await page.request.put('/api/administracao/liberacao/prerequisitos', {
    headers: { 'x-csrf': await csrf(page), 'idempotency-key': `e2e-m56-4-pre-${situacao}-${Date.now()}` },
    data: {
      recurso: 'operadora',
      tipo: 'credenciamento',
      situacao,
      validade: situacao === 'cumprido' ? '2099-12-31' : null,
      evidencia: situacao === 'cumprido' ? 'registro sintético 900001' : null,
      senha: SENHA,
    },
  });
  expect(r.status(), await r.text()).toBe(200);
}

/** CPF sintético com os dígitos verificadores calculados (um por execução: a rede em memória dura o servidor). */
function cpfSintetico(): string {
  let base = String(Date.now()).slice(-9);
  if (/^(\d)\1{8}$/.test(base)) base = '123456780';
  const dv = (b: string) => {
    let s = 0;
    for (let i = 0; i < b.length; i++) s += Number(b[i]) * (b.length + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const a = base + String(dv(base));
  return a + String(dv(a));
}

test.describe('operadora própria, etapa 4: rede credenciada e prestadora @M56.4', () => {
  test.setTimeout(300_000);

  test('desligada → ligada → credenciar, recusa, alterar, descredenciar com substituto, reincluir → auditor e administrador; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const cpf = cpfSintetico();
    const nome = `Consultório sintético ${cpf.slice(-4)}`;

    // A rede nasce desligada (POL-3): a tela diz o motivo e não mostra a rede.
    await entrar(page, 'SINT.CREDENCIAMENTO');
    await page.goto('/operadora/rede');
    await expect(page.getByRole('heading', { level: 1, name: 'Rede credenciada' })).toBeVisible();
    await expect(page.getByTestId('rede-desligada')).toContainText('desligada', { timeout: 30_000 });
    await expect(page.getByTestId('rede-prestadores')).toHaveCount(0);
    // As tabelas da rede (CRUD genérico do grupo operadora) seguem embutidas.
    await expect(page.getByTestId('grupo-dominios-operadoraRede')).toBeVisible();
    await semViolacaoAxe(page, '/operadora/rede (desligada)');

    // O administrador registra o número da operadora na ANS e liga a operadora e a rede para as pessoas do teste.
    await entrar(page, 'SINT.ADMIN');
    await registroAns(page, 'cumprido');
    await chave(page, 'operadora', true);
    await chave(page, 'operadora.rede', true);
    // O administrador do hospital não tem perfil da operadora: não abre a rede.
    await page.goto('/operadora/rede');
    await expect(page.getByTestId('tela-operadora-rede')).toHaveCount(0);

    try {
      await entrar(page, 'SINT.CREDENCIAMENTO');
      await page.goto('/operadora/rede');
      const tabela = page.getByTestId('rede-prestadores');
      await expect(tabela).toBeVisible({ timeout: 30_000 });
      await expect(tabela).toContainText('Hospital sintético Beta');
      await expect(page.getByTestId('rede-total-credenciados')).toBeVisible();
      await semViolacaoAxe(page, '/operadora/rede');

      // Credenciar: a recusa da regra (pessoa física só como consultório) e depois o consultório.
      await page.getByTestId('rede-credenciar').click();
      const form = page.getByTestId('form-prestador');
      await expect(form).toBeVisible();
      await escolher(form.getByTestId('rede-pessoa'), { rotulo: 'Física' });
      await form.getByLabel('CPF ou CNPJ').fill(cpf);
      await form.getByLabel('Nome ou razão social').fill(nome);
      await form.getByLabel('Código do município (IBGE, 7 dígitos)').fill('4205407');
      await escolher(form.getByTestId('rede-tipo'), { rotulo: 'Hospital geral' });
      await escolher(form.getByTestId('rede-natureza'), { indice: 1 });
      await escolher(form.getByTestId('rede-classificacao'), { rotulo: 'Demais estabelecimentos' });
      await escolher(form.getByTestId('rede-regime'), { rotulo: 'Ambulatorial' });
      await form.getByLabel('Número do contrato').fill('SINT-E2E-1');
      await semViolacaoAxe(page, 'credenciar prestador');
      await form.getByTestId('rede-gravar').click();
      await expect(form.getByTestId('rede-recusa')).toContainText('Pessoa física só como consultório');
      await escolher(form.getByTestId('rede-tipo'), { rotulo: 'Consultório médico' });
      await form.getByTestId('rede-gravar').click();
      await expect(page.getByTestId('rede-mensagem')).toContainText('Prestador credenciado');
      // A ficha abre com o CPF por inteiro; a lista, mascarado.
      const ficha = page.getByTestId('rede-ficha');
      await expect(ficha.getByTestId('rede-ficha-documento')).toHaveText(
        `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`,
      );
      await expect(ficha.getByTestId('rede-ficha-movimentos')).toContainText('Inclusão');
      await page.getByLabel('Nome, CPF, CNPJ ou CNES').fill(nome);
      await page.getByTestId('rede-buscar').click();
      await expect(tabela.locator('tbody tr')).toHaveCount(1);
      await expect(tabela).toContainText(`***.***.${cpf.slice(6, 9)}-${cpf.slice(9)}`);

      // Alterar o CNES: vai ao registro de prestadores da ANS como alteração.
      await ficha.getByTestId('rede-alterar').click();
      await expect(form).toBeVisible();
      await form.getByLabel('CNES (7 dígitos)').fill('9000123');
      await form.getByTestId('rede-gravar').click();
      await expect(page.getByTestId('rede-mensagem')).toContainText(
        'A alteração vai ao registro de prestadores',
      );
      await expect(ficha.getByTestId('rede-ficha-movimentos')).toContainText('Alteração');
      await expect(ficha.getByTestId('rede-ficha-movimentos')).toContainText('CNES');

      // Descredenciar o hospital Beta: sem substituto, a recusa; com o Gama (outro município), o aviso.
      await page.getByLabel('Nome, CPF, CNPJ ou CNES').fill('Beta');
      await page.getByTestId('rede-buscar').click();
      await expect(tabela.locator('tbody tr')).toHaveCount(1);
      await tabela.getByRole('button', { name: /Abrir Hospital sintético Beta/ }).click();
      await expect(ficha.getByTestId('rede-ficha-situacao')).toContainText('Credenciado');
      await ficha.getByTestId('rede-descredenciar').click();
      const desc = page.getByTestId('form-descredenciar');
      await desc.getByLabel('Motivo do descredenciamento').fill('Encerramento sintético do contrato (E2E)');
      await semViolacaoAxe(page, 'descredenciar prestador');
      await page.getByTestId('rede-desc-confirmar').click();
      await page.getByTestId('confirmacao').getByRole('button', { name: 'Confirmar' }).click();
      await expect(desc.getByTestId('rede-desc-recusa')).toContainText('substituto equivalente');
      await escolher(desc.getByTestId('rede-desc-substituto'), { rotulo: /Hospital sintético Gama/ });
      await page.getByTestId('rede-desc-confirmar').click();
      await page.getByTestId('confirmacao').getByRole('button', { name: 'Confirmar' }).click();
      await expect(page.getByTestId('rede-mensagem')).toContainText('Prestador descredenciado');
      await expect(page.getByTestId('rede-avisos')).toContainText('outro município');
      // A saída fica agendada (a data efetiva é pelo menos 30 dias depois do aviso): até lá segue credenciado.
      await expect(ficha.getByTestId('rede-ficha-situacao')).toContainText('Credenciado');
      await expect(ficha.getByTestId('rede-ficha-situacao')).toContainText('sai da rede em');
      await expect(ficha.getByTestId('rede-alterar')).toHaveCount(0);

      // Cancelar a saída (reinclusão antes da data) com o contrato novo.
      await expect(ficha.getByTestId('rede-reincluir')).toContainText('Cancelar a saída da rede');
      await ficha.getByTestId('rede-reincluir').click();
      const reinc = page.getByTestId('form-reincluir');
      await reinc.getByLabel('Motivo da reinclusão').fill('Novo contrato sintético assinado (E2E)');
      await reinc.getByLabel('Número do contrato').fill('SINT-E2E-2');
      await page.getByTestId('rede-reinc-confirmar').click();
      await expect(page.getByTestId('rede-mensagem')).toContainText('Prestador reincluído');
      await expect(ficha.getByTestId('rede-ficha-situacao')).toContainText('Credenciado');
      await expect(ficha.getByTestId('rede-ficha-contrato')).toContainText('SINT-E2E-2');

      // Os movimentos a enviar ao registro de prestadores da ANS.
      const rps = page.getByTestId('rede-rps-pendentes');
      for (const m of ['Inclusão', 'Alteração', 'Exclusão', 'Reinclusão']) await expect(rps).toContainText(m);
      await semViolacaoAxe(page, '/operadora/rede (movimentos)');

      // O auditor da operadora só consulta: a rede sem o botão de credenciar nem as ações da ficha.
      await entrar(page, 'SINT.OPE.AUDITOR');
      await page.goto('/operadora/rede');
      await expect(page.getByTestId('rede-prestadores')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('rede-credenciar')).toHaveCount(0);
      await page
        .getByTestId('rede-prestadores')
        .getByRole('button', { name: /Abrir Hospital sintético Beta/ })
        .click();
      await expect(page.getByTestId('rede-ficha')).toBeVisible();
      await expect(page.getByTestId('rede-descredenciar')).toHaveCount(0);
    } finally {
      // Recolher: desligar a rede e a operadora para as pessoas do teste e voltar o pré-requisito.
      await entrar(page, 'SINT.ADMIN');
      await chave(page, 'operadora.rede', false);
      await chave(page, 'operadora', false);
      await registroAns(page, 'pendente');
    }
    await entrar(page, 'SINT.CREDENCIAMENTO');
    await page.goto('/operadora/rede');
    await expect(page.getByTestId('rede-desligada')).toBeVisible({ timeout: 30_000 });
    expect(externas).toEqual([]);
  });
});
