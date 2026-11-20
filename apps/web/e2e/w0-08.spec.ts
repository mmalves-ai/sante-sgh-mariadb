// E2E @W0-08 (CRUD completo: manutenção e patrimônio, correções e estornos), parte do patrimônio: o responsável pelo
// patrimônio inclui um grupo do bem novo, altera-o pela versão com motivo (a versão anterior fica visível), cadastra um
// bem da nota sintética nesse grupo → tenta excluir o grupo (409 com a contagem e a oferta de inativar) → inativa em vez
// de excluir e reativa → inclui e exclui um grupo nunca usado → calcula a depreciação e estorna o último cálculo com o
// motivo, a senha e a confirmação (o estorno fica visível e a competência volta a ser calculável) → abre um inventário,
// lê a plaqueta e o cancela com motivo (as leituras seguem visíveis) → na ficha do bem, registra a perda por impairment
// com o laudo (o PDF anexado ao bem e escolhido no combo; o link abre o arquivo conferido) e a estorna com motivo e
// senha (M1). Axe sem violação séria em cada estado.
// Sessão, notas e bens SINTÉTICOS em memória (nada vai à cópia; nenhuma pessoa). Rode sozinho (o item da nota é
// consumido pelo cadastro, como no @M54.6).
import { expect, type Locator, type Page, test } from '@playwright/test';
import { itemDoMenu, ORIGEM, semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const GRUPO = 'e2eW008';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const campo = (l: Locator) =>
  l.locator('xpath=self::input | self::textarea | .//input | .//textarea').first();
/** Pedido da página com o CSRF da sessão e a Idempotency-Key, como a tela faz (para provocar o 409). */
async function pedir(page: Page, method: 'POST' | 'PUT', url: string, data: unknown) {
  const csrf = (await page.context().cookies(ORIGEM)).find((c) => c.name === 'sgh_csrf')?.value ?? '';
  return page.request.fetch(url, {
    method,
    data: data as Record<string, unknown>,
    headers: {
      'x-csrf': csrf,
      'idempotency-key': `e2e-w008-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    },
  });
}
async function confirmar(page: Page): Promise<void> {
  await page.getByTestId('confirmacao').getByRole('button', { name: 'Confirmar' }).click();
}

test.describe('CRUD completo do patrimônio @W0-08', () => {
  test.setTimeout(300_000);

  test('grupo do bem I/A/inativação com recusa de órfão → estorno da depreciação → inventário cancelado → ajuste de valor registrado e estornado; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.PATRIMONIO');
    await (await itemDoMenu(page, 'Cadastro de bens, plaquetas e responsáveis')).click();
    await expect(page.getByTestId('tela-bens')).toBeVisible({ timeout: 30_000 });

    // 1. Grupos do bem: os 8 da semente; incluir um novo.
    await page.getByTestId('bens-aba-grupos').click();
    const grupos = page.getByTestId('grupos-bem');
    await expect(grupos.getByTestId('grupo-equipamentoMedico')).toBeVisible({ timeout: 30_000 });
    await semViolacaoAxe(page, '/patrimonio/bens (grupos do bem)');
    await grupos.getByTestId('grupo-incluir').click();
    const inc = grupos.getByTestId('grupo-form-incluir');
    await campo(inc.getByTestId('grupo-codigo')).fill(GRUPO);
    await campo(inc.getByTestId('grupo-nome')).fill('Grupo sintético E2E W0-08');
    await campo(inc.getByTestId('grupo-vida')).fill('96');
    await semViolacaoAxe(page, '/patrimonio/bens (incluir grupo)');
    await inc.getByTestId('grupo-gravar').click();
    await expect(grupos.getByTestId('grupos-bem-aviso')).toContainText('incluído', { timeout: 30_000 });
    await expect(grupos.getByTestId(`grupo-${GRUPO}`)).toContainText('96 meses');

    // 2. Alterar pela versão lida, com motivo; a versão anterior fica visível.
    await grupos.getByTestId(`grupo-alterar-${GRUPO}`).click();
    const alt = grupos.getByTestId('grupo-form-alterar');
    await campo(alt.getByTestId('grupo-vida')).fill('120');
    await escolher(alt.getByTestId('grupo-conta'), '1.2.3.01');
    await campo(alt.getByTestId('grupo-motivo')).fill('Laudo da engenharia clínica (E2E W0-08).');
    await alt.getByTestId('grupo-gravar').click();
    await expect(grupos.getByTestId('grupos-bem-aviso')).toContainText('alterado', { timeout: 30_000 });
    await expect(grupos.getByTestId(`grupo-${GRUPO}`)).toContainText('120 meses');
    await grupos.getByTestId(`grupo-alterar-${GRUPO}`).click();
    const versoes = grupos.getByTestId('grupo-versoes');
    await expect(versoes).toContainText('96 meses', { timeout: 30_000 });
    await expect(versoes).toContainText('Laudo da engenharia clínica');
    await expect(versoes).toContainText(/\d{2}\/\d{2}\/\d{4}/);
    await semViolacaoAxe(page, '/patrimonio/bens (versões do grupo)');
    await grupos.getByTestId('grupo-cancelar').click();

    // 3. Um bem da nota sintética no grupo novo.
    await page.getByTestId('bens-aba-cadastrar').click();
    const form = page.getByTestId('form-cadastro-bem');
    await escolher(form.getByTestId('cadastro-competencia'), { rotulo: '03/2026' });
    await form.getByTestId('nota-escolher-9001').click({ timeout: 30_000 });
    await form.getByTestId('item-escolher-90012').click({ timeout: 30_000 });
    await form.getByTestId('cadastro-ir-dados').click();
    await escolher(form.getByTestId('cadastro-grupo'), { rotulo: 'Grupo sintético E2E W0-08' });
    await escolher(form.getByTestId('cadastro-origem'), { rotulo: 'Próprio' });
    await escolher(form.getByTestId('cadastro-centro'), { rotulo: /UTI ADULTO SINTETICA/ });
    await form.getByTestId('cadastro-ir-conferir').click();
    await form.getByTestId('cadastro-gravar').click();
    const gravado = form.getByTestId('cadastro-gravado');
    await expect(gravado).toContainText('1 bens cadastrados', { timeout: 30_000 });
    const plaqueta = /:\s*([A-Za-z0-9-]+)\.\s*$/.exec((await gravado.innerText()).trim())?.[1] ?? '';
    expect(plaqueta).not.toBe('');

    // 4. Excluir o grupo com bem: 409 com a contagem e a oferta de inativar; inativa em vez de excluir; reativa.
    await page.getByTestId('bens-aba-grupos').click();
    await grupos.getByTestId(`grupo-excluir-${GRUPO}`).click();
    const exc = grupos.getByTestId('grupo-form-excluir');
    await campo(exc.getByTestId('grupo-motivo')).fill('Grupo criado por engano (E2E W0-08).');
    await exc.getByTestId('grupo-gravar').click();
    await confirmar(page);
    const dep = grupos.getByTestId('grupo-dependentes');
    await expect(dep).toContainText(': 1', { timeout: 30_000 });
    await semViolacaoAxe(page, '/patrimonio/bens (exclusão do grupo recusada)');
    await dep.getByTestId('grupo-inativar-em-vez').click();
    await grupos.getByTestId('grupo-form-inativar').getByTestId('grupo-gravar').click();
    await expect(grupos.getByTestId('grupos-bem-aviso')).toContainText('inativado', { timeout: 30_000 });
    await expect(grupos.getByTestId(`grupo-${GRUPO}`)).toContainText('Inativo');
    await grupos.getByTestId(`grupo-reativar-${GRUPO}`).click();
    const rea = grupos.getByTestId('grupo-form-reativar');
    await campo(rea.getByTestId('grupo-motivo')).fill('Reativado para os bens novos (E2E W0-08).');
    await rea.getByTestId('grupo-gravar').click();
    await expect(grupos.getByTestId('grupos-bem-aviso')).toContainText('reativado', { timeout: 30_000 });

    // 5. O grupo nunca usado se exclui (com o registro no histórico de exclusões).
    await grupos.getByTestId('grupo-incluir').click();
    await campo(inc.getByTestId('grupo-codigo')).fill(`${GRUPO}x`);
    await campo(inc.getByTestId('grupo-nome')).fill('Grupo sintético por engano');
    await campo(inc.getByTestId('grupo-vida')).fill('60');
    await inc.getByTestId('grupo-gravar').click();
    await expect(grupos.getByTestId(`grupo-${GRUPO}x`)).toBeVisible({ timeout: 30_000 });
    await grupos.getByTestId(`grupo-excluir-${GRUPO}x`).click();
    await campo(exc.getByTestId('grupo-motivo')).fill('Incluído por engano (E2E W0-08).');
    await exc.getByTestId('grupo-gravar').click();
    await confirmar(page);
    await expect(grupos.getByTestId('grupos-bem-aviso')).toContainText('excluído', { timeout: 30_000 });
    await expect(grupos.getByTestId(`grupo-${GRUPO}x`)).toHaveCount(0);

    // 6. Depreciação: calcula e estorna o último cálculo com motivo, a senha e a confirmação.
    await (await itemDoMenu(page, 'Depreciação')).click();
    await expect(page.getByTestId('tela-depreciacao')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('deprec-total')).toBeVisible({ timeout: 30_000 });
    if ((await page.getByTestId('deprec-calcular').count()) > 0) {
      await page.getByTestId('deprec-calcular').click();
      await confirmar(page);
      await expect(page.getByTestId('deprec-cotas')).toBeVisible({ timeout: 30_000 });
    }
    await page.getByTestId('deprec-estornar').click();
    const est = page.getByTestId('deprec-estorno');
    await campo(est.getByTestId('deprec-estorno-motivo')).fill('Cálculo com o grupo errado (E2E W0-08).');
    await est.getByTestId('deprec-estorno-senha').fill(SENHA);
    await semViolacaoAxe(page, '/patrimonio/depreciacao (estorno)');
    await est.getByTestId('deprec-estorno-confirmar').click();
    await confirmar(page);
    await expect(page.getByTestId('deprec-mensagem')).toContainText('estornado', { timeout: 30_000 });
    await expect(page.getByTestId('deprec-estornos')).toBeVisible();
    await expect(page.getByTestId('deprec-calcular')).toBeVisible();
    await page.getByTestId('deprec-estornos').locator('summary').click();
    await expect(page.getByTestId('deprec-estornos')).toContainText('Cálculo com o grupo errado');
    await semViolacaoAxe(page, '/patrimonio/depreciacao (estornada)');

    // 7. Inventário: abre, lê a plaqueta e cancela com motivo; as leituras seguem visíveis.
    await page.goto('/patrimonio/inventario');
    const abrir = page.getByTestId('inv-abrir');
    await expect(abrir).toBeVisible({ timeout: 30_000 });
    await campo(abrir.getByTestId('inv-nome')).fill('Inventário da UTI (E2E W0-08)');
    await escolher(abrir.getByTestId('inv-escopo'), { rotulo: /UTI ADULTO SINTETICA/ });
    await abrir.getByTestId('inv-abrir-gravar').click();
    const detalhe = page.getByTestId('inv-detalhe');
    await expect(detalhe.getByTestId('inv-leitor')).toBeVisible({ timeout: 30_000 });
    await campo(detalhe.getByTestId('inv-codigo')).fill(plaqueta);
    await detalhe.getByTestId('inv-ler').click();
    await expect(detalhe.getByTestId('inv-ultima')).toContainText('Encontrado no lugar', { timeout: 30_000 });
    await detalhe.getByTestId('inv-cancelar').click();
    await campo(detalhe.getByTestId('inv-cancelar-motivo')).fill('Aberto no setor errado (E2E W0-08).');
    await semViolacaoAxe(page, '/patrimonio/inventario (cancelar)');
    await detalhe.getByTestId('inv-cancelar-confirmar').click();
    await confirmar(page);
    await expect(detalhe.getByTestId('inv-cancelado')).toContainText('Aberto no setor errado', {
      timeout: 30_000,
    });
    await expect(detalhe.getByTestId('inv-leitor')).toHaveCount(0);
    await expect(detalhe.getByTestId('inv-leituras')).toContainText(plaqueta);
    await semViolacaoAxe(page, '/patrimonio/inventario (cancelado)');

    // 8. Ajuste de valor (M1): na ficha do bem, anexa o PDF do laudo (achado 6: arquivo guardado, não um número
    // digitado), registra a perda por impairment com ele (revisão prospectiva da depreciação) e estorna o ajuste com
    // motivo, a senha e a confirmação; o estornado segue visível.
    await page.goto('/patrimonio/bens');
    await expect(page.getByTestId('tela-bens')).toBeVisible({ timeout: 30_000 });
    await campo(page.getByTestId('bens-codigo-campo')).fill(plaqueta);
    await page.getByTestId('bens-codigo-abrir').click();
    const aj = page.getByTestId('ajustes-bem');
    await expect(aj.getByTestId('ajustes-nenhum')).toBeVisible({ timeout: 30_000 });
    await aj.getByTestId('ajustes-registrar').click();
    const fa = aj.getByTestId('ajustes-form');
    await campo(fa.getByTestId('ajustes-recuperavel')).fill('1,00');
    await campo(fa.getByTestId('ajustes-motivo')).fill('Laudo de recuperabilidade (E2E W0-08).');
    const ls = aj.getByTestId('laudos-bem');
    await expect(ls.getByTestId('laudos-nenhum')).toBeVisible({ timeout: 30_000 });
    await ls.getByTestId('laudos-anexar').click();
    const fl = ls.getByTestId('laudos-form');
    const pdf = Buffer.from('%PDF-1.7\n% laudo sintético E2E W0-08\n%%EOF\n');
    await fl.getByTestId('laudos-arquivo').setInputFiles({
      name: 'laudo-e2e-w008.pdf',
      mimeType: 'application/pdf',
      buffer: pdf,
    });
    await campo(fl.getByTestId('laudos-descricao')).fill('Teste de recuperabilidade (E2E W0-08)');
    await semViolacaoAxe(page, '/patrimonio/bens (anexar laudo)');
    await fl.getByTestId('laudos-enviar').click();
    await expect(aj.getByTestId('ajustes-mensagem')).toContainText('anexado', { timeout: 30_000 });
    const laudoLinha = ls.getByTestId('laudos-lista').locator('li').first();
    await expect(laudoLinha).toContainText('laudo-e2e-w008.pdf');
    const href = await laudoLinha.getByRole('link').getAttribute('href');
    expect(href).toMatch(/^\/api\/patrimonio\/laudos\/\d+\/arquivo$/);
    const arquivo = await page.request.get(`${ORIGEM}${href}`);
    expect(arquivo.status()).toBe(200);
    expect(Buffer.from(await arquivo.body()).equals(pdf)).toBe(true);
    const idLaudo = href!.split('/')[4]!;
    // O ajuste aberto já escolhe o laudo recém-anexado no combo.
    await expect(fa.getByTestId('ajustes-laudo')).toHaveAttribute('data-valor', idLaudo);
    await semViolacaoAxe(page, '/patrimonio/bens (ajuste de valor)');
    await fa.getByTestId('ajustes-gravar').click();
    await expect(aj.getByTestId('ajustes-mensagem')).toContainText('registrado', { timeout: 30_000 });
    const linha = aj.getByTestId('ajustes-lista').locator('li').first();
    await expect(linha).toContainText(`Laudo nº ${idLaudo}`, { timeout: 30_000 });
    await expect(linha.getByRole('link', { name: `Laudo nº ${idLaudo}` })).toHaveAttribute('href', href!);
    await linha.getByRole('button', { name: 'Estornar o ajuste' }).click();
    const ea = aj.getByTestId('ajustes-estorno');
    await campo(ea.getByTestId('ajustes-estorno-motivo')).fill('Laudo refeito pelo perito (E2E W0-08).');
    await ea.getByTestId('ajustes-estorno-senha').fill(SENHA);
    await ea.getByTestId('ajustes-estorno-confirmar').click();
    await confirmar(page);
    await expect(aj.getByTestId('ajustes-mensagem')).toContainText('estornado', { timeout: 30_000 });
    await expect(linha).toContainText('Laudo refeito pelo perito', { timeout: 30_000 });
    await semViolacaoAxe(page, '/patrimonio/bens (ajuste estornado)');

    expect(externas).toEqual([]);
  });

  test('manutenção: corrigir a OS antes de assumida (409 depois) → plano alterado pela versão (409 na versão velha) → contrato alterado, exclusão com vínculo recusada e encerrado com motivo → alerta de recall com a OS de ação de campo, a queixa técnica e o encerramento → cursos do modelo, aptos, índice, ciclo de vida e PGTS → modelo pronto do PMOC e relatório com o responsável técnico; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);

    // 1. O setor abre a OS pelo QR e corrige a abertura com motivo enquanto ninguém a assumiu.
    await entrar(page, 'SINT.MANUTENCAO.SETOR');
    await page.goto('/manutencao/os?abrir=EQ-CC-001');
    const form = page.getByTestId('os-form-abrir');
    await expect(form).toBeVisible({ timeout: 30_000 });
    await campo(form.getByTestId('os-abrir-descricao')).fill('Alarme disparando sem motivo (E2E W0-08).');
    const [resposta] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/manutencao/os') && r.request().method() === 'POST'),
      form.getByTestId('os-abrir-gravar').click(),
    ]);
    expect(resposta.status()).toBe(201);
    const os = (await resposta.json()) as { id: number };
    await page.goto(`/manutencao/os?os=${os.id}`);
    let d = page.getByTestId('os-detalhe');
    await expect(d).toBeVisible({ timeout: 30_000 });
    await d.getByTestId('os-acao-corrigir').click();
    const fc = d.getByTestId('os-form-corrigir');
    await expect(fc).toBeVisible();
    await escolher(fc.getByTestId('os-corrigir-prioridade'), { rotulo: 'Alta' });
    await campo(fc.getByTestId('os-corrigir-descricao')).fill(
      'Alarme de apneia disparando sem paciente conectado (E2E W0-08).',
    );
    await campo(fc.getByTestId('os-corrigir-motivo')).fill('Faltou dizer qual alarme dispara.');
    await semViolacaoAxe(page, '/manutencao/os (corrigir a abertura)');
    await fc.getByTestId('os-corrigir-gravar').click();
    await expect(d.getByTestId('os-mensagem')).toBeVisible({ timeout: 30_000 });
    await expect(d.getByTestId('os-historico')).toContainText('Faltou dizer qual alarme dispara.');
    await expect(d).toContainText('Alarme de apneia');

    // 2. O técnico assume; depois disso a correção some da tela e a rota devolve 409 os-assumida.
    await entrar(page, 'SINT.MANUTENCAO.TECNICO');
    await page.goto(`/manutencao/os?os=${os.id}`);
    d = page.getByTestId('os-detalhe');
    await expect(d).toBeVisible({ timeout: 30_000 });
    await d.getByTestId('os-acao-assumir').click();
    await d.getByTestId('os-acao-gravar').click();
    await expect(d.getByTestId('os-situacao')).toContainText('Em atendimento', { timeout: 30_000 });
    await entrar(page, 'SINT.MANUTENCAO.SETOR');
    await page.goto(`/manutencao/os?os=${os.id}`);
    d = page.getByTestId('os-detalhe');
    await expect(d.getByTestId('os-situacao')).toContainText('Em atendimento', { timeout: 30_000 });
    await expect(d.getByTestId('os-acao-corrigir')).toHaveCount(0);
    const lida = (await (await page.request.get(`/api/manutencao/os/${os.id}`)).json()) as {
      versao: number;
    };
    const tarde = await pedir(page, 'POST', `/api/manutencao/os/${os.id}/correcao`, {
      versao: lida.versao,
      equipamento: 9001,
      centroCusto: 102,
      descricao: 'Tentativa depois de assumida (E2E W0-08).',
      prioridadeSugerida: 'baixa',
      motivo: 'Correção tardia',
    });
    expect(tarde.status()).toBe(409);
    expect(((await tarde.json()) as { codigo: string }).codigo).toBe('os-assumida');

    // 3. A chefia altera o plano 9202 pela versão lida, com motivo; a versão anterior fica visível.
    await entrar(page, 'SINT.MANUTENCAO');
    await page.goto('/manutencao/equipamentos');
    await expect(page.getByTestId('tela-manutencao-equipamentos')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('equipamento-abrir-9003').click();
    const ficha = page.getByTestId('equipamento-ficha');
    await expect(ficha.getByTestId('plano-9202')).toBeVisible({ timeout: 30_000 });
    await ficha.getByTestId('plano-alterar-9202').click();
    const fp = ficha.getByTestId('plano-form-alterar');
    await expect(fp).toBeVisible({ timeout: 30_000 });
    await campo(fp.getByTestId('plano-alterar-antecedencia')).fill('15');
    await campo(fp.getByTestId('plano-alterar-motivo')).fill(
      'Aviso com 15 dias para separar o kit da preventiva.',
    );
    await semViolacaoAxe(page, '/manutencao/equipamentos (alterar o plano)');
    await fp.getByTestId('plano-alterar-gravar').click();
    await expect(ficha.getByTestId('equipamento-mensagem')).toBeVisible({ timeout: 30_000 });
    await ficha.getByTestId('plano-alterar-9202').click();
    await expect(ficha.getByTestId('plano-versao-1')).toContainText('Aviso com 15 dias', { timeout: 30_000 });
    await semViolacaoAxe(page, '/manutencao/equipamentos (versões do plano)');
    const velha = await pedir(page, 'PUT', '/api/manutencao/plano/9202', {
      versao: 1,
      periodicidade: { quantidade: 6, unidade: 'meses' },
      dataBase: '2026-11-05',
      antecedenciaDias: 20,
      procedimento: null,
      executor: 'interno',
      cobertura: null,
      motivo: 'Gravação concorrente com a versão velha',
    });
    expect(velha.status()).toBe(409);
    expect(((await velha.json()) as { codigo: string }).codigo).toBe('desatualizado');
    await ficha.getByTestId('plano-alterar-cancelar').click();
    await page.getByTestId('equipamento-fechar').click();

    // 4. Contrato 9101: alterar o SLA pela versão com motivo; excluir recusa (o plano 9201 da semente está vinculado) e oferece
    //    encerrar; encerrar com motivo.
    await page.getByTestId('equipamentos-aba-contratos').click();
    const contratos = page.getByTestId('contratos-manutencao');
    await expect(contratos.getByTestId('contrato-9101')).toBeVisible({ timeout: 30_000 });
    await contratos.getByTestId('contrato-alterar-9101').click();
    let g = contratos.getByTestId('contrato-gerir-alterar');
    await expect(g.getByTestId('contrato-gerir-form')).toBeVisible({ timeout: 30_000 });
    await campo(g.getByTestId('contrato-gerir-sla')).fill('6');
    await campo(g.getByTestId('contrato-gerir-motivo')).fill('Aditivo reduziu o SLA para 6 horas.');
    await semViolacaoAxe(page, '/manutencao/equipamentos (alterar o contrato)');
    await g.getByTestId('contrato-gerir-gravar').click();
    await expect(contratos.getByTestId('contratos-mensagem')).toBeVisible({ timeout: 30_000 });
    await expect(contratos.getByTestId('contrato-9101').locator('td').nth(4)).toHaveText('6');

    await contratos.getByTestId('contrato-excluir-9101').click();
    g = contratos.getByTestId('contrato-gerir-excluir');
    await expect(g.getByTestId('contrato-versao-1')).toContainText('Aditivo reduziu', { timeout: 30_000 });
    await campo(g.getByTestId('contrato-gerir-motivo')).fill('Contrato lançado em duplicidade.');
    await g.getByTestId('contrato-gerir-gravar').click();
    await confirmar(page);
    const deps = contratos.getByTestId('contrato-gerir-dependentes');
    await expect(deps).toContainText('Planos de manutenção: 1', { timeout: 30_000 });
    await semViolacaoAxe(page, '/manutencao/equipamentos (exclusão recusada com os vínculos)');
    await deps.getByTestId('contrato-gerir-encerrar-em-vez').click();
    g = contratos.getByTestId('contrato-gerir-encerrar');
    await expect(g.getByTestId('contrato-gerir-data')).toBeVisible();
    await campo(g.getByTestId('contrato-gerir-motivo')).fill('Fornecedor substituído; contrato encerrado.');
    await g.getByTestId('contrato-gerir-gravar').click();
    // O plano ativo 9201 ainda é executado pelo contrato: o encerramento recusa e diz o caminho.
    await expect(g.getByRole('alert')).toContainText('plano de manutenção ativo', { timeout: 30_000 });
    await g.getByTestId('contrato-gerir-cancelar').click();

    // 5. O plano 9201 passa à equipe própria (alterado pela versão, com motivo) e o contrato se encerra com motivo.
    await page.getByTestId('equipamentos-aba-lista').click();
    await page.getByTestId('equipamento-abrir-9001').click();
    await ficha.getByTestId('plano-alterar-9201').click();
    const fq = ficha.getByTestId('plano-form-alterar');
    await expect(fq).toBeVisible({ timeout: 30_000 });
    await escolher(fq.getByTestId('plano-alterar-executor'), { rotulo: 'Equipe própria' });
    await campo(fq.getByTestId('plano-alterar-motivo')).fill('Calibração passa à equipe própria.');
    await fq.getByTestId('plano-alterar-gravar').click();
    await expect(ficha.getByTestId('equipamento-mensagem')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('equipamento-fechar').click();
    await page.getByTestId('equipamentos-aba-contratos').click();
    await contratos.getByTestId('contrato-encerrar-9101').click();
    g = contratos.getByTestId('contrato-gerir-encerrar');
    await expect(g.getByTestId('contrato-gerir-data')).toBeVisible({ timeout: 30_000 });
    await campo(g.getByTestId('contrato-gerir-motivo')).fill('Fornecedor substituído; contrato encerrado.');
    await semViolacaoAxe(page, '/manutencao/equipamentos (encerrar o contrato)');
    await g.getByTestId('contrato-gerir-gravar').click();
    await expect(contratos.getByTestId('contratos-mensagem')).toBeVisible({ timeout: 30_000 });
    await expect(contratos.getByTestId('contrato-encerrar-9101')).toHaveCount(0, { timeout: 30_000 });
    await expect(contratos.getByTestId('contrato-9101')).toBeVisible();
    await semViolacaoAxe(page, '/manutencao/equipamentos (contrato encerrado)');

    // 6. Tecnovigilância (M2): o recall registrado à mão acha o 9001 da semente pela faixa de série e gera uma OS de
    //    ação de campo para ele; a OS abre a queixa técnica na qualidade; a exclusão do alerta com OS recusa e oferece
    //    encerrar, que encerra com motivo.
    const numeroAlerta = `AL-E2E-${Date.now() % 1_000_000}`;
    await page.getByTestId('equipamentos-aba-alertas').click();
    const aba = page.getByTestId('aba-alertas');
    await expect(aba).toBeVisible({ timeout: 30_000 });
    await aba.getByTestId('alertas-novo').click();
    const fa = page.getByTestId('alerta-form');
    await expect(fa).toBeVisible({ timeout: 30_000 });
    await campo(fa.getByTestId('alerta-numero')).fill(numeroAlerta);
    await escolher(fa.getByTestId('alerta-tipo'), {
      rotulo: 'Recolhimento ou ação de campo do fabricante (recall)',
    });
    await campo(fa.getByTestId('alerta-titulo')).fill('Bateria pode desligar o monitor (E2E W0-08)');
    await campo(fa.getByTestId('alerta-fabricante')).fill('Fabricante Sintetico');
    await campo(fa.getByTestId('alerta-modelo')).fill('MX-1');
    await campo(fa.getByTestId('alerta-serie-inicio')).fill('SN-0001');
    await campo(fa.getByTestId('alerta-serie-fim')).fill('SN-0005');
    await campo(fa.getByTestId('alerta-descricao')).fill('Bateria do lote pode desligar o aparelho em uso.');
    await campo(fa.getByTestId('alerta-acao')).fill('Inspecionar e trocar a bateria do lote afetado.');
    await semViolacaoAxe(page, '/manutencao/equipamentos (registrar o alerta)');
    await fa.getByTestId('alerta-gravar').click();
    const da = aba.getByTestId('alerta-detalhe');
    await expect(da).toContainText(numeroAlerta, { timeout: 30_000 });
    await expect(da.getByTestId('alerta-afetado-9001')).toContainText('SN-0001');
    await da.getByTestId('alerta-gerar').click();
    await expect(da.getByTestId('alerta-mensagem')).toBeVisible({ timeout: 30_000 });
    const linkOs = da.getByTestId('alerta-afetado-9001').getByRole('link').first();
    await expect(linkOs).toBeVisible({ timeout: 30_000 });
    await semViolacaoAxe(page, '/manutencao/equipamentos (alerta com a ação de campo)');
    await linkOs.click();
    const dq = page.getByTestId('os-detalhe');
    await expect(dq.getByTestId('os-do-alerta')).toContainText(numeroAlerta, { timeout: 30_000 });
    await dq.getByTestId('os-acao-queixa').click();
    const fqx = dq.getByTestId('os-form-queixa');
    await expect(fqx).toBeVisible();
    await campo(fqx.getByTestId('os-queixa-descricao')).fill(
      'Monitor desligou sozinho durante a inspeção do recall (E2E W0-08).',
    );
    await semViolacaoAxe(page, '/manutencao/os (abrir a queixa técnica)');
    await fqx.getByTestId('os-queixa-gravar').click();
    await expect(dq.getByTestId('os-queixa')).toBeVisible({ timeout: 30_000 });
    await expect(dq.getByTestId('os-acao-queixa')).toHaveCount(0);

    await page.goto('/manutencao/equipamentos');
    await page.getByTestId('equipamentos-aba-alertas').click();
    const linha = page.getByTestId('tabela-alertas').locator('tr', { hasText: numeroAlerta });
    await expect(linha).toBeVisible({ timeout: 30_000 });
    await linha.getByRole('button').click();
    const de = page.getByTestId('alerta-detalhe');
    await expect(de.getByTestId('alerta-afetado-9001')).toContainText('Queixa', { timeout: 30_000 });
    await de.getByTestId('alerta-excluir').click();
    await campo(de.getByTestId('alerta-gerir-motivo')).fill('Alerta registrado em duplicidade.');
    await de.getByTestId('alerta-gerir-gravar').click();
    await confirmar(page);
    const depA = de.getByTestId('alerta-dependentes');
    await expect(depA).toBeVisible({ timeout: 30_000 });
    await semViolacaoAxe(page, '/manutencao/equipamentos (exclusão do alerta recusada)');
    await depA.getByTestId('alerta-encerrar-em-vez').click();
    const fe = de.getByTestId('alerta-form-encerrar');
    await expect(fe).toBeVisible();
    await campo(fe.getByTestId('alerta-gerir-motivo')).fill('Ação de campo concluída no parque.');
    await fe.getByTestId('alerta-gerir-gravar').click();
    await expect(de.getByTestId('alerta-situacao')).toHaveText('Encerrado', { timeout: 30_000 });
    await expect(de.getByTestId('alerta-encerrado')).toContainText('Ação de campo concluída');

    // 7. Treinamento e ciclo de vida (M3): na ficha do 9001, exige o curso do treinamento para o modelo (aptos e
    // pendentes pelo curso concluído), vê o índice de obsolescência com a conta, registra a incorporação, deixa de exigir
    // o curso com motivo e baixa o PGTS em PDF.
    await page.goto('/manutencao/equipamentos');
    await page.getByTestId('equipamento-abrir-9001').click();
    const ciclo = page.getByTestId('equipamento-ciclo');
    await ciclo.getByTestId('ciclo-alternar').click();
    await expect(ciclo.getByTestId('ciclo-indice-conta')).toContainText('Índice = idade + custo + falhas', {
      timeout: 30_000,
    });
    await escolher(ciclo.getByTestId('ciclo-curso-escolha'), {
      rotulo: 'OPMX - Operação do monitor MX-1 (24 meses)',
    });
    await ciclo.getByTestId('ciclo-curso-exigir').click();
    await expect(ciclo.getByTestId('ciclo-mensagem')).toContainText('Curso exigido', { timeout: 30_000 });
    await expect(ciclo.getByTestId('ciclo-apto-801')).toContainText('Ana Operadora Sintética', {
      timeout: 30_000,
    });
    await expect(ciclo.getByTestId('ciclo-apto-802')).toBeVisible();
    await expect(ciclo.getByTestId('ciclo-pendente-803')).toContainText('Operação do monitor MX-1');
    await semViolacaoAxe(page, '/manutencao/equipamentos (operadores e ciclo de vida)');

    await ciclo.getByTestId('ciclo-evento-novo').click();
    const fev = ciclo.getByTestId('ciclo-evento-form');
    await campo(fev.getByTestId('ciclo-evento-autorizado')).fill('Diretoria Sintética');
    await campo(fev.getByTestId('ciclo-evento-motivo')).fill(
      'Incorporação do monitor ao parque (E2E W0-08).',
    );
    await fev.getByTestId('ciclo-evento-gravar').click();
    await expect(ciclo.getByTestId('ciclo-eventos')).toContainText('Incorporação do monitor ao parque', {
      timeout: 30_000,
    });

    await ciclo.locator('[data-testid^="ciclo-curso-remover-"]').first().click();
    await campo(ciclo.getByTestId('ciclo-curso-motivo')).fill('O fabricante trocou o treinamento do modelo.');
    await ciclo.getByTestId('ciclo-curso-confirmar-remocao').click();
    await expect(ciclo.getByTestId('ciclo-mensagem')).toContainText('deixou de ser exigido', {
      timeout: 30_000,
    });
    await expect(ciclo.getByTestId('ciclo-aptos')).toHaveCount(0);

    const pgts = await page.request.get((await ciclo.getByTestId('ciclo-pgts').getAttribute('href')) ?? '');
    expect(pgts.status()).toBe(200);
    expect(pgts.headers()['content-type']).toContain('application/pdf');

    // 8. PMOC e infraestrutura crítica (M4): instala o modelo pronto do PMOC na ficha (selo no plano), a segunda
    // instalação do mesmo modelo é recusada com o aviso traduzido; no painel, o relatório do PMOC sem o responsável
    // técnico cadastrado é recusado com o aviso; com o parâmetro cadastrado (administração), o PDF sai.
    const fichaM4 = page.getByTestId('equipamento-ficha');
    await fichaM4.getByTestId('plano-modelo').click();
    let fm = fichaM4.getByTestId('modelo-plano-form');
    await escolher(fm.getByTestId('modelo-plano-escolha'), {
      rotulo: 'PMOC: equipamento de ar condicionado',
    });
    await expect(fm.getByTestId('modelo-plano-resumo')).toContainText('Lei 13.589/2018');
    await semViolacaoAxe(page, '/manutencao/equipamentos (modelo pronto de plano)');
    await fm.getByTestId('modelo-plano-instalar').click();
    await expect(fichaM4.getByTestId('equipamento-mensagem')).toBeVisible({ timeout: 30_000 });
    await expect(
      fichaM4.getByTestId('equipamento-planos').locator('[data-testid^="plano-modelo-"]'),
    ).toContainText('PMOC: equipamento de ar condicionado', { timeout: 30_000 });
    await fichaM4.getByTestId('plano-modelo').click();
    fm = fichaM4.getByTestId('modelo-plano-form');
    await escolher(fm.getByTestId('modelo-plano-escolha'), {
      rotulo: 'PMOC: equipamento de ar condicionado',
    });
    await fm.getByTestId('modelo-plano-instalar').click();
    await expect(fm.getByTestId('recusa-manutencao')).toContainText('já está instalado e ativo', {
      timeout: 30_000,
    });

    await page.getByTestId('equipamentos-aba-painel').click();
    let rel = page.getByTestId('pmoc-relatorio');
    await expect(
      page.getByTestId('painel-plano-itens').locator('[data-testid^="painel-modelo-"]'),
    ).toContainText('PMOC', { timeout: 30_000 });
    await rel.getByTestId('pmoc-gerar').click();
    await expect(rel.getByTestId('recusa-manutencao')).toContainText('Falta o responsável técnico do PMOC', {
      timeout: 30_000,
    });
    await semViolacaoAxe(page, '/manutencao/equipamentos (relatório do PMOC)');

    await entrar(page, 'SINT.ADMIN');
    const par = await pedir(page, 'PUT', '/api/administracao/parametros/manutencao.pmocResponsavelTecnico', {
      nivel: 'estabelecimento',
      alvo: 'pc',
      valor: 'Eng. Responsável Sintético; CREA-SP 0000000000; ART 0000000001',
      justificativa: 'Responsável técnico sintético do PMOC no E2E do W0-08',
      senha: SENHA,
    });
    expect([200, 201, 409], await par.text()).toContain(par.status());
    await entrar(page, 'SINT.MANUTENCAO');
    await page.goto('/manutencao/equipamentos');
    await page.getByTestId('equipamentos-aba-painel').click();
    rel = page.getByTestId('pmoc-relatorio');
    const [baixado] = await Promise.all([
      page.waitForEvent('download'),
      rel.getByTestId('pmoc-gerar').click(),
    ]);
    expect(baixado.suggestedFilename()).toMatch(/\.pdf$/);
    await expect(rel.getByTestId('pmoc-gerado')).toBeVisible({ timeout: 30_000 });

    expect(externas).toEqual([]);
  });
});
