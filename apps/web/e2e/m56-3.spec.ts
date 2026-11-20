// E2E @M56.3 (ficha do M56, etapa 3 de 8, fatia F2; seções 7, 8 e 10 na parte da cobrança): a cobrança nasce
// desligada (a tela diz o motivo) → o administrador registra os pré-requisitos (o registro da operadora na ANS e o
// convênio de cobrança bancária) e liga a operadora, os beneficiários e a cobrança para as pessoas do teste → o gestor
// cadastra a carteira sintética pela API da F1 (operadora, plano com coparticipação, contrato de pessoa física com dia
// de vencimento, titular e dependente) → a cobrança da operadora registra o reajuste anual (o acima do teto da ANS é
// recusado), vê a prévia e gera as mensalidades (a faixa etária com o reajuste) de três competências, registra o
// pagamento da futura, vê a inadimplência das duas vencidas (notificar até o 50º dia), registra a notificação, faz o
// acordo das vencidas em 2 parcelas e lança uma coparticipação → o atendimento só consulta → o administrador do
// hospital não abre a cobrança → recolher (desligar). Axe sem violação séria em cada estado. Sessão real sobre a
// fonte sintética de dev, operadora em MEMÓRIA (nada vai à cópia). Documentos SINTÉTICOS (dígitos calculados aqui).
import { expect, test, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const PESSOAS = ['SINT.OPERADORA', 'SINT.OPE.COBRANCA', 'SINT.OPE.ATENDE'];

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

async function postar(page: Page, url: string, data: unknown): Promise<{ id: number }> {
  const r = await page.request.post(url, {
    headers: { 'x-csrf': await csrf(page), 'idempotency-key': `e2e-m56-3-${Date.now()}-${Math.random()}` },
    data: data as Record<string, unknown>,
  });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()) as { id: number };
}

/** Liga ou desliga a chave para as pessoas do teste (Funcionalidades por estabelecimento; reautenticação). */
async function chave(page: Page, nome: string, ligar: boolean): Promise<void> {
  const r = await page.request.post('/api/administracao/liberacao', {
    headers: { 'x-csrf': await csrf(page), 'idempotency-key': `e2e-m56-3-${nome}-${ligar}-${Date.now()}` },
    data: {
      chave: nome,
      tipo: 'recurso',
      escopo: 'pessoa',
      valores: PESSOAS,
      ligar,
      justificativa: 'Cobrança sintética da operadora (E2E da etapa 3)',
      senha: SENHA,
    },
  });
  expect(r.status(), await r.text()).toBe(200);
}

async function prerequisito(
  page: Page,
  recurso: string,
  tipo: string,
  situacao: 'cumprido' | 'pendente',
): Promise<void> {
  const r = await page.request.put('/api/administracao/liberacao/prerequisitos', {
    headers: {
      'x-csrf': await csrf(page),
      'idempotency-key': `e2e-m56-3-pre-${recurso}-${situacao}-${Date.now()}`,
    },
    data: {
      recurso,
      tipo,
      situacao,
      validade: situacao === 'cumprido' ? '2099-12-31' : null,
      evidencia: situacao === 'cumprido' ? 'evidência sintética do E2E M56.3' : null,
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
const cpf = (b9: string) => {
  const d1 = dv11(b9, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${b9}${d1}${dv11(`${b9}${d1}`, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2])}`;
};
const cnpj = (b12: string) => {
  const d1 = dv11(b12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${b12}${d1}${dv11(`${b12}${d1}`, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])}`;
};
/** Competência somada de meses (AAAA-MM). */
const competencia = (base: Date, meses: number) => {
  const d = new Date(Date.UTC(base.getFullYear(), base.getMonth() + meses, 1));
  return d.toISOString().slice(0, 7);
};

test.describe('operadora própria, etapa 3: cobrança e mensalidades @M56.3', () => {
  test.setTimeout(300_000);

  test('desligada → ligada → reajuste → mensalidades → pagamento → inadimplência e notificação → acordo → coparticipação → só consulta → recolher; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const sufixo = String(Date.now() % 100_000).padStart(5, '0');
    const registro = `8${sufixo}`;
    const numero = `COB-E2E-${sufixo}`;
    const hoje = new Date();
    const [c1, c2, c3] = [competencia(hoje, -2), competencia(hoje, -1), competencia(hoje, 1)];
    const reajuste = `${hoje.getFullYear()}-01`;

    // Regra 1: com a parte desligada, a tela só diz o motivo.
    await entrar(page, 'SINT.OPE.COBRANCA');
    await page.goto('/operadora/cobranca');
    await expect(page.getByRole('heading', { level: 1, name: 'Cobrança e mensalidades' })).toBeVisible();
    await expect(page.getByTestId('operadora-fatia-desligada')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('aba-cobranca-cobrancas')).toHaveCount(0);
    await semViolacaoAxe(page, '/operadora/cobranca (desligada)');

    // O administrador registra os pré-requisitos e liga a operadora, os beneficiários e a cobrança.
    await entrar(page, 'SINT.ADMIN');
    await prerequisito(page, 'operadora', 'credenciamento', 'cumprido');
    await prerequisito(page, 'operadora.cobranca', 'contrato', 'cumprido');
    for (const k of ['operadora', 'operadora.beneficiarios', 'operadora.cobranca'])
      await chave(page, k, true);

    try {
      // O gestor cadastra a carteira sintética pela API da F1.
      await entrar(page, 'SINT.OPERADORA');
      const ope = await postar(page, '/api/operadora/empresas', {
        registroAns: registro,
        cnpj: cnpj(`8${sufixo}000300`.slice(0, 12)),
        razaoSocial: `Operadora Sintética da Cobrança ${registro}`,
        modalidade: 'medicinaGrupo',
      });
      const prod = await postar(page, '/api/operadora/produtos', {
        operadora: ope.id,
        codigo: `COB-${sufixo}`,
        nome: 'Plano sintético da cobrança',
        natureza: 'plano',
        registroAns: `${registro}003`,
        tipoContratacao: 1,
        segmentacao: 'ambulatorialHospitalar',
        abrangencia: 'estadual',
        acomodacao: 2,
        coparticipacao: { tipo: 2, valor: 30 },
        carencias: { urgencia: 1, partos: 300, demais: 180, cpt: 24 },
        precos: [100, 120, 130, 140, 150, 170, 200, 240, 300, 400],
      });
      const ctr = await postar(page, '/api/operadora/contratos', {
        produto: prod.id,
        numero,
        tipo: 1,
        contratanteNome: 'Contratante Sintético da Cobrança',
        contratanteDocumento: cpf(`7${sufixo}031`.slice(0, 9)),
        formaReajuste: 1,
        mesReajuste: 1,
        tipoVigencia: 2,
        inicio: `${hoje.getFullYear() - 1}-01-15`,
        diaVencimento: 10,
      });
      const tit = await postar(page, '/api/operadora/beneficiarios', {
        contrato: ctr.id,
        vinculo: 1,
        nome: 'Titular Sintética da Cobrança',
        cpf: cpf(`6${sufixo}032`.slice(0, 9)),
        nascimento: '1980-05-10',
        sexo: 'F',
        nomeMae: 'Mãe Sintética',
        inclusao: `${hoje.getFullYear() - 1}-01-15`,
      });
      await postar(page, '/api/operadora/beneficiarios', {
        contrato: ctr.id,
        titular: tit.id,
        vinculo: 5,
        nome: 'Dependente Sintético da Cobrança',
        nascimento: '2015-03-01',
        sexo: 'M',
        nomeMae: 'Titular Sintética da Cobrança',
        inclusao: `${hoje.getFullYear() - 1}-02-01`,
      });

      // A cobrança da operadora abre a tela.
      await entrar(page, 'SINT.OPE.COBRANCA');
      await page.goto('/operadora/cobranca');
      await expect(page.getByTestId('aba-cobranca-cobrancas')).toBeVisible({ timeout: 30_000 });
      const sel = page.getByTestId('cobranca-operadora');
      if (await sel.count()) await escolher(sel, { rotulo: new RegExp(registro) });
      await semViolacaoAxe(page, '/operadora/cobranca (ligada)');

      // Reajuste anual: acima do teto da ANS, a recusa; dentro, registrado.
      await page.getByTestId('aba-cobranca-reajustes').click();
      const rj = page.getByTestId('operadora-reajustes');
      await escolher(rj.getByTestId('reajuste-contrato-escolha'), { rotulo: new RegExp(numero) });
      const fr = page.getByTestId('form-reajuste');
      await fr.getByLabel('Competência do reajuste (AAAA-MM)').fill(reajuste);
      await fr.getByLabel('Percentual (%)').fill('7,5');
      await fr.getByLabel('Percentual máximo autorizado pela ANS (%)').fill('6,91');
      await fr.getByLabel('Ofício ou resolução da ANS').fill('Ofício sintético 1');
      await fr.getByLabel('Motivo').fill('Reajuste anual sintético');
      await page.getByTestId('reajuste-gravar').click();
      await expect(page.getByTestId('recusa-operadora')).toContainText('máximo autorizado pela ANS');
      await fr.getByLabel('Percentual (%)').fill('6,91');
      await semViolacaoAxe(page, 'reajuste');
      await page.getByTestId('reajuste-gravar').click();
      await expect(page.getByTestId('mensagem-reajuste')).toContainText('6,91%');
      await expect(page.getByTestId(`reajuste-${numero}-${reajuste}`)).toContainText('Vigente');

      // Mensalidades: prévia da próxima competência (titular 200 e dependente 100, com 6,91%) e geração; depois as
      // duas passadas (vencidas).
      await page.getByTestId('aba-cobranca-mensalidades').click();
      const ms = page.getByTestId('operadora-mensalidades');
      await escolher(ms.getByTestId('mensalidades-contrato-escolha'), { rotulo: new RegExp(numero) });
      for (const c of [c3, c1, c2]) {
        await ms.getByLabel('Competência (AAAA-MM)').fill(c);
        await page.getByTestId('mensalidades-previa').click();
        await expect(page.getByTestId('previa-resumo')).toContainText('1 mensalidade(s), total R$ 320,73');
        if (c === c3) {
          await expect(page.getByTestId(`previa-${numero}`)).toContainText('213,82');
          await semViolacaoAxe(page, 'prévia das mensalidades');
        }
        await page.getByTestId('mensalidades-gerar').click();
        await page.getByTestId('confirmacao').getByRole('button', { name: 'Confirmar' }).click();
        await expect(page.getByTestId('mensagem-mensalidades')).toContainText('1 mensalidade(s)');
      }
      // A segunda geração não repete.
      await ms.getByLabel('Competência (AAAA-MM)').fill(c3);
      await page.getByTestId('mensalidades-previa').click();
      await expect(page.getByTestId('previa-resumo')).toContainText(
        '0 mensalidade(s), total R$ 0,00; 1 já gerada(s)',
      );

      // Cobranças: o pagamento da futura (o devido já vem no campo).
      await page.getByTestId('aba-cobranca-cobrancas').click();
      const cb = page.getByTestId('operadora-cobrancas');
      await cb.getByLabel('Número do contrato').fill(numero);
      await page.getByTestId('cobranca-buscar').click();
      const tabela = page.getByTestId('tabela-cobrancas');
      await expect(tabela.locator('tbody tr')).toHaveCount(3);
      await expect(tabela).toContainText('***.');
      await tabela
        .locator('tbody tr', { hasText: `${c3.slice(5, 7)}/${c3.slice(0, 4)}` })
        .getByRole('button', { name: 'Abrir' })
        .click();
      const ficha = page.getByTestId('ficha-cobranca');
      await expect(ficha.getByTestId('tabela-itens-cobranca').locator('tbody tr')).toHaveCount(2);
      await semViolacaoAxe(page, 'ficha da cobrança');
      await page.getByTestId('cobranca-baixar').click();
      await page.getByTestId('baixa-gravar').click();
      await expect(page.getByTestId('mensagem-cobranca')).toContainText('320,73');
      await expect(ficha).toHaveAttribute('data-situacao', 'paga');

      // A ficha da vencida: o devido na data vem com a multa e os juros; com a dispensa, o campo volta ao valor e o
      // texto diz que os encargos estão dispensados; sem a dispensa, o devido da data de novo (nada é gravado aqui).
      await tabela
        .locator('tbody tr', { hasText: `${c1.slice(5, 7)}/${c1.slice(0, 4)}` })
        .getByRole('button', { name: 'Abrir' })
        .click();
      await expect(ficha).toHaveAttribute('data-situacao', 'aberta');
      await page.getByTestId('cobranca-baixar').click();
      const fb = page.getByTestId('form-baixa');
      const valorPago = fb.getByLabel('Valor pago (R$)');
      await expect(page.getByTestId('baixa-devido')).toContainText('multa R$');
      const comEncargos = await valorPago.inputValue();
      expect(comEncargos).not.toBe('320,73');
      await page.getByTestId('baixa-dispensar').check();
      await expect(valorPago).toHaveValue('320,73');
      await expect(page.getByTestId('baixa-devido')).toContainText('R$ 320,73 (multa e juros dispensados)');
      await semViolacaoAxe(page, 'baixa com a dispensa');
      await page.getByTestId('baixa-dispensar').uncheck();
      await expect(valorPago).toHaveValue(comEncargos);
      await fb.getByRole('button', { name: 'Voltar' }).click();
      await ficha.getByRole('button', { name: 'Fechar' }).click();
      await expect(ficha).toHaveCount(0);

      // Inadimplência: as duas vencidas, notificar; a notificação por carta.
      await page.getByTestId('aba-cobranca-inadimplencia').click();
      const linha = page.getByTestId(`inadimplente-${numero}`);
      await expect(linha).toHaveAttribute('data-situacao', 'notificar');
      await expect(page.getByTestId('inadimplencia-mensagens')).toContainText('mensagens ao beneficiário');
      await semViolacaoAxe(page, 'inadimplência');
      await page.getByTestId(`notificar-${numero}`).click();
      await page
        .getByTestId('form-notificacao')
        .getByLabel(/Referência/)
        .fill('AR sintético E2E');
      await page.getByTestId('notificacao-gravar').click();
      await expect(page.getByTestId('mensagem-inadimplencia')).toContainText('2 cobrança(s)');
      await expect(linha).toHaveAttribute('data-situacao', 'aguardando-prazo');

      // Acordo das duas vencidas em 2 parcelas.
      await page.getByTestId('aba-cobranca-acordo').click();
      const ac = page.getByTestId('operadora-acordo');
      await escolher(ac.getByTestId('acordo-contrato-escolha'), { rotulo: new RegExp(numero) });
      await page.getByTestId(`acordo-escolher-${c1}-1`).check();
      await page.getByTestId(`acordo-escolher-${c2}-1`).check();
      await escolher(page.getByTestId('acordo-parcelas'), '2');
      await page.getByTestId('acordo-previa').click();
      await expect(page.getByTestId('acordo-resumo')).toContainText('Principal R$ 641,46');
      await expect(page.getByTestId('tabela-acordo-parcelas').locator('tbody tr')).toHaveCount(2);
      await semViolacaoAxe(page, 'acordo');
      await page.getByTestId('acordo-fazer').click();
      await page.getByTestId('confirmacao').getByRole('button', { name: 'Confirmar' }).click();
      await expect(page.getByTestId('mensagem-acordo')).toContainText('2 parcela(s)');

      // Coparticipação do dependente (30% de 250 = 75).
      await page.getByTestId('aba-cobranca-lancamentos').click();
      const lc = page.getByTestId('operadora-lancamentos');
      await lc
        .getByLabel('Beneficiário (carteirinha, CPF ou início do nome)')
        .fill('Dependente Sintético da Cob');
      await page.getByTestId('lancamento-buscar').click();
      await escolher(page.getByTestId('lancamento-beneficiario'), {
        rotulo: /Dependente Sintético da Cobrança/,
      });
      const fl = page.getByTestId('form-lancamento');
      await fl.getByLabel('Competência (AAAA-MM)').fill(c3);
      await fl.getByLabel('Vencimento').fill(`10/${c3.slice(5, 7)}/${c3.slice(0, 4)}`);
      await fl.getByLabel('Vencimento').press('Tab');
      await fl.getByLabel('Valor do evento (R$)').fill('250');
      await fl.getByLabel('Descrição').fill('Consulta eletiva sintética');
      await semViolacaoAxe(page, 'lançamento');
      await page.getByTestId('lancamento-gravar').click();
      await expect(page.getByTestId('mensagem-lancamento')).toContainText('Coparticipação lançada');

      // O atendimento da operadora só consulta.
      await entrar(page, 'SINT.OPE.ATENDE');
      await page.goto('/operadora/cobranca');
      await expect(page.getByTestId('cobranca-so-consulta')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('aba-cobranca-mensalidades')).toHaveCount(0);
      await expect(page.getByTestId('aba-cobranca-acordo')).toHaveCount(0);
      await semViolacaoAxe(page, '/operadora/cobranca (só consulta)');

      // O administrador do hospital não abre a cobrança da operadora.
      await entrar(page, 'SINT.ADMIN');
      await page.goto('/operadora/cobranca');
      await expect(page.getByTestId('tela-operadora-cobranca')).toHaveCount(0);
    } finally {
      // Recolher: desliga as chaves das pessoas do teste e volta os pré-requisitos a pendentes.
      await entrar(page, 'SINT.ADMIN');
      for (const k of ['operadora.cobranca', 'operadora.beneficiarios', 'operadora'])
        await chave(page, k, false);
      await prerequisito(page, 'operadora.cobranca', 'contrato', 'pendente');
      await prerequisito(page, 'operadora', 'credenciamento', 'pendente');
    }
    expect(externas).toEqual([]);
  });
});
