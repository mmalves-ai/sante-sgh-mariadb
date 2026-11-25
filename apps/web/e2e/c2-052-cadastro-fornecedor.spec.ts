// E2E @C2-052 (05-SUP linha 23): cadastro do fornecedor compartilhado com o financeiro, avaliação periódica e
// ocorrências, pela tela /suprimentos/fornecedores (rota real do módulo, permissão suprimentos.fornecedor.ler). A porta
// grava só no banco próprio: na sessão sintética de dev/ci (logins SINT.*, sem o núcleo) GET
// /api/suprimentos/cadastro-fornecedor responde 503 e a tela mostra o erro no bloco do cadastro, sem oferecer gravação,
// com a consulta intacta (primeiro teste). O segundo teste simula as rotas do cadastro (page.route com respostas
// sintéticas) e percorre o ciclo pela tela: CNPJ inválido recusado na hora, inclusão com contato e categoria, contato
// alterado, conta incluída (conta sem agência recusada na hora), avaliação com a prévia da conta, ocorrência registrada
// e resolvida (encerrar sem tratativa recusado na hora), conferindo o corpo de cada POST e a Idempotency-Key. O efeito
// no MariaDB está em apps/api/src/modulos/suprimentos/cadastro-fornecedor.int.spec.ts. Massa SINTÉTICA.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const B = '/api/suprimentos/cadastro-fornecedor';
const HOJE = '2026-11-25';
/** CNPJ sintético com dígitos verificadores válidos (11.222.333/0001-81). */
const CNPJ = '11222333000181';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

async function abrirTela(page: Page): Promise<number> {
  const leitura = page.waitForResponse((r) => r.url().endsWith(B) && r.request().method() === 'GET');
  await page.goto('/suprimentos/fornecedores');
  await expect(page.getByTestId('tela-suprimentos-fornecedores')).toBeVisible();
  return (await leitura).status();
}

test.describe('@C2-052 Cadastro do fornecedor, avaliação e ocorrências', () => {
  test.describe.configure({ mode: 'serial', timeout: 240_000 });

  test('sem o banco do cliente, o cadastro mostra o erro e não oferece gravação; a consulta segue; axe', async ({
    page,
  }) => {
    vigiarExternas(page);
    await entrar(page, 'SINT.ALMOXARIFE');
    const status = await abrirTela(page);
    const bloco = page.getByTestId('forn-cadastro');
    if (status === 503) {
      await expect(bloco.getByTestId('mensagem-erro').first()).toBeVisible();
      await expect(bloco.getByTestId('forn-cadastro-novo')).toHaveCount(0);
      await expect(page.getByTestId('cforn-painel')).toHaveCount(0);
    } else {
      expect(status).toBe(200);
    }
    await expect(page.getByTestId('forn-buscar')).toBeVisible();
    await semViolacaoAxe(page, '/suprimentos/fornecedores');
  });

  test('ciclo pela tela com a API simulada: incluir, alterar, conta, avaliação e ocorrência; axe', async ({
    page,
  }) => {
    vigiarExternas(page);
    const json = (rota: Route, corpo: unknown, status = 200) =>
      rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });
    const posts: { caminho: string; corpo: Record<string, unknown>; chave: string | null }[] = [];
    let ficha: Record<string, unknown> | null = null;
    const base = (dados: Record<string, unknown>, versao: number) => ({
      id: 70,
      versao,
      razaoSocial: dados['razaoSocial'],
      nomeFantasia: dados['nomeFantasia'] ?? null,
      tipoPessoa: 'juridica',
      documento: '11.222.333/0001-81',
      situacao: 'ativo',
      dados: { ...dados },
      categorias: dados['categorias'],
      categoriaPrincipal: dados['categoriaPrincipal'],
      contatos: (dados['contatos'] as Record<string, unknown>[]).map((c, i) => ({ ...c, id: 800 + i })),
      autorizacoes: [],
      contas: [],
      avaliacoes: [],
      ocorrencias: [],
      proximaAvaliacao: null,
      avisos: [
        {
          codigo: 'sem-autorizacao',
          mensagem: 'Categoria exige autorização sanitária e não há nenhuma cadastrada.',
          gravidade: 'atencao',
        },
      ],
    });
    await page.route(`**${B}**`, async (rota) => {
      const req = rota.request();
      const caminho = new URL(req.url()).pathname;
      if (req.method() === 'POST') {
        const corpo = req.postDataJSON() as Record<string, unknown>;
        posts.push({ caminho, corpo, chave: req.headers()['idempotency-key'] ?? null });
        if (caminho === B) {
          ficha = base(corpo, 1);
          return json(rota, { ok: true, id: 70, mensagem: 'Fornecedor incluído.' }, 201);
        }
        if (caminho === `${B}/70/alteracao`) {
          ficha = { ...base(corpo['fornecedor'] as Record<string, unknown>, 2) };
          return json(rota, { ok: true, mensagem: 'Fornecedor alterado.' });
        }
        if (caminho === `${B}/70/contas`) {
          ficha = {
            ...ficha!,
            contas: [
              {
                id: 31,
                versao: 1,
                banco: '001 Banco sintético',
                tipoConta: 'corrente',
                agencia: '1234',
                contaMascarada: '••••5678',
                tipoChavePix: null,
                titularNome: 'Distribuidora Sintética',
                preferencial: true,
                ativo: true,
              },
            ],
          };
          return json(
            rota,
            { ok: true, id: 31, mensagem: 'Conta incluída: o financeiro já a usa no pagamento.' },
            201,
          );
        }
        if (caminho === `${B}/70/avaliacoes`) {
          ficha = {
            ...ficha!,
            avaliacoes: [
              {
                id: 41,
                avaliadoEm: HOJE,
                periodoInicio: null,
                periodoFim: null,
                notas: { qualidade: 5, prazo: 4, atendimento: 4, documentacao: 3 },
                media: 4,
                resultado: 'qualificado',
                conta: '(5 + 4 + 4 + 3) ÷ 4 = 4,00',
                mediaPeriodo: 4,
                parecer: null,
                avaliador: 1,
              },
            ],
            proximaAvaliacao: '2027-11-25',
          };
          return json(
            rota,
            {
              ok: true,
              id: 41,
              conta: '(5 + 4 + 4 + 3) ÷ 4 = 4,00',
              resultado: 'qualificado',
              mensagem: 'Avaliação gravada.',
            },
            201,
          );
        }
        if (caminho === `${B}/70/ocorrencias`) {
          ficha = {
            ...ficha!,
            ocorrencias: [
              {
                id: 51,
                versao: 1,
                numero: 1,
                tipo: corpo['tipo'],
                gravidade: corpo['gravidade'],
                ocorridoEm: corpo['ocorridoEm'],
                quantidadeAfetada: corpo['quantidadeAfetada'],
                valorAfetado: null,
                descricao: corpo['descricao'],
                situacao: 'aberta',
                notificadoEm: null,
                emailNotificacao: null,
                tratativa: null,
                resolvidaEm: null,
              },
            ],
          };
          return json(rota, { ok: true, id: 51, numero: 1, mensagem: 'Ocorrência 1 registrada.' }, 201);
        }
        if (caminho === `${B}/ocorrencias/51/andamento`) {
          const oc = (ficha!['ocorrencias'] as Record<string, unknown>[])[0]!;
          ficha = {
            ...ficha!,
            ocorrencias: [{ ...oc, versao: 2, situacao: corpo['situacao'], tratativa: corpo['tratativa'] }],
          };
          return json(rota, { ok: true, mensagem: 'Andamento da ocorrência gravado.' });
        }
        return json(rota, { title: 'rota não simulada' }, 404);
      }
      if (caminho === B)
        return json(rota, {
          hoje: HOJE,
          categorias: [
            { id: 1, descricao: 'Medicamentos sintéticos', exigeAutorizacao: true },
            { id: 2, descricao: 'Material de escritório sintético', exigeAutorizacao: false },
          ],
          bancos: [{ id: 9, descricao: '001 Banco sintético' }],
          pode: { editar: true, avaliar: true },
        });
      if (caminho === `${B}/busca`) return json(rota, { itens: ficha ? [ficha] : [] });
      if (caminho === `${B}/70`) return json(rota, ficha);
      return json(rota, { title: 'rota não simulada' }, 404);
    });

    await entrar(page, 'SINT.ALMOXARIFE');
    await abrirTela(page);
    await page.getByTestId('forn-cadastro-novo').click();
    const painel = page.getByTestId('cforn-painel');
    await expect(painel).toBeVisible();

    // Validação na hora: CNPJ com dígito errado e sem razão social recusam antes de gravar.
    await painel.getByTestId('cforn-documento').fill('11222333000180');
    await expect(painel.getByTestId('cforn-recusas')).toBeVisible();
    await expect(painel.getByTestId('cforn-gravar')).toBeDisabled();

    await painel.getByTestId('cforn-documento').fill(CNPJ);
    await painel.getByTestId('cforn-razao').fill('Distribuidora Sintética Ltda');
    await painel.getByTestId('cforn-categoria-1').check();
    await escolher(painel.getByTestId('cforn-categoria-principal'), '1');
    await painel.getByTestId('cforn-contato-incluir').click();
    await escolher(painel.getByTestId('cforn-contato-finalidade-0'), 'financeiro');
    await painel.getByTestId('cforn-contato-nome-0').fill('Contato Sintético');
    await painel.getByTestId('cforn-contato-email-0').fill('financeiro@sintetico.test');
    await expect(painel.getByTestId('cforn-recusas')).toHaveCount(0);
    await painel.getByTestId('cforn-gravar').click();
    await expect(painel.getByTestId('cforn-mensagem')).toContainText('Fornecedor incluído.');
    await expect(painel.getByTestId('cforn-avisos')).toBeVisible();

    // Alterar o contato (versão conferida).
    await painel.getByTestId('cforn-contato-tel-0').fill('1133334444');
    await painel.getByTestId('cforn-gravar').click();
    await expect(painel.getByTestId('cforn-mensagem')).toContainText('Fornecedor alterado.');

    // Conta: sem agência recusada na hora; depois incluída.
    await escolher(painel.getByTestId('cforn-conta-banco'), '9');
    await painel.getByTestId('cforn-conta-numero').fill('12345678');
    await painel.getByTestId('cforn-conta-titular').fill('Distribuidora Sintética');
    await painel.getByTestId('cforn-conta-titular-doc').fill(CNPJ);
    await expect(painel.getByTestId('cforn-conta-recusas')).toContainText('agência');
    await painel.getByTestId('cforn-conta-agencia').fill('1234');
    await expect(painel.getByTestId('cforn-conta-recusas')).toHaveCount(0);
    await painel.getByTestId('cforn-conta-incluir').click();
    await expect(painel.getByTestId('cforn-conta-31')).toContainText('••••5678');

    // Avaliação periódica com a prévia da conta.
    await escolher(painel.getByTestId('cforn-nota-qualidade'), '5');
    await escolher(painel.getByTestId('cforn-nota-prazo'), '4');
    await escolher(painel.getByTestId('cforn-nota-atendimento'), '4');
    await expect(painel.getByTestId('cforn-aval-previa')).toContainText('Qualificado');
    await painel.getByTestId('cforn-aval-registrar').click();
    await expect(painel.getByTestId('cforn-avaliacao-41')).toBeVisible();

    // Ocorrência: avaria pede a quantidade; registrada e resolvida com a tratativa.
    await escolher(painel.getByTestId('cforn-oc-tipo'), 'avaria');
    await painel.getByTestId('cforn-oc-descricao').fill('Caixa sintética amassada na entrega');
    await expect(painel.getByTestId('cforn-oc-recusas')).toContainText('quantidade');
    await painel.getByTestId('cforn-oc-qtd').fill('2');
    await painel.getByTestId('cforn-oc-registrar').click();
    await expect(painel.getByTestId('cforn-ocorrencia-situacao-1')).toHaveText('Aberta');
    await escolher(painel.getByTestId('cforn-andamento-situacao-1'), 'resolvida');
    await expect(painel.getByTestId('cforn-andamento-gravar-1')).toBeDisabled();
    await painel.getByTestId('cforn-andamento-tratativa-1').fill('Fornecedor repôs as unidades sintéticas');
    await painel.getByTestId('cforn-andamento-gravar-1').click();
    await expect(painel.getByTestId('cforn-ocorrencia-situacao-1')).toHaveText('Resolvida');

    // Os corpos enviados e a Idempotency-Key em todos.
    expect(posts.map((p) => p.caminho)).toEqual([
      B,
      `${B}/70/alteracao`,
      `${B}/70/contas`,
      `${B}/70/avaliacoes`,
      `${B}/70/ocorrencias`,
      `${B}/ocorrencias/51/andamento`,
    ]);
    for (const p of posts) expect(p.chave).toMatch(/^[A-Za-z0-9._:-]{8,80}$/);
    expect(posts[0]!.corpo).toMatchObject({ documento: CNPJ, categorias: [1], categoriaPrincipal: 1 });
    expect((posts[1]!.corpo as { versao: number }).versao).toBe(1);
    expect(posts[2]!.corpo).toMatchObject({ banco: 9, agencia: '1234', conta: '12345678' });
    expect(posts[3]!.corpo).toMatchObject({
      notas: { qualidade: 5, prazo: 4, atendimento: 4, documentacao: 3 },
    });
    expect(posts[4]!.corpo).toMatchObject({ tipo: 'avaria', quantidadeAfetada: 2 });
    expect(posts[5]!.corpo).toMatchObject({ situacao: 'resolvida', versao: 1 });
    await semViolacaoAxe(page, '/suprimentos/fornecedores');
  });
});
