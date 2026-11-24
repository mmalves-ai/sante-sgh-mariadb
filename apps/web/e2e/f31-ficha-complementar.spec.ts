// F3.1 (02-CAD linhas 2, 3 e 4): regras de campo do cadastro, contatos e responsáveis do paciente, pelo caminho da tela.
// A ficha complementar exige o banco próprio, e o E2E roda com a fonte sintética (sem núcleo). Por isso as respostas da
// API destas rotas são simuladas pelo Playwright com massa SINTÉTICA; o que se prova é a tela: a validação na hora (o
// pedido inválido não sai), o corpo de cada pedido, a lista que volta, as pendências e a acessibilidade. O efeito no
// banco (um principal por espécie, nada apagado, aceite como consentimento do titular, pessoa única pelo CPF, regra mais
// específica, regra de outro estabelecimento recusada) está no contrato de efeito
// (apps/api/src/modulos/cadastro/ficha-complementar.int.spec.ts).
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const PACIENTE = 7301;

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

interface Pedido {
  readonly caminho: string;
  readonly corpo: Record<string, unknown>;
}

async function simularFicha(page: Page, pedidos: Pedido[]): Promise<void> {
  const contatos = {
    enderecos: [
      {
        id: 11,
        tipo: 'Residencial',
        cep: '01001000',
        logradouro: 'RUA SINTETICA',
        numero: '10',
        complemento: null,
        bairro: 'CENTRO',
        principal: true,
        vigenciaInicio: '2026-01-01',
        vigenciaFim: null,
        vigente: true,
      },
    ],
    telefones: [] as unknown[],
    emails: [
      {
        id: 31,
        email: 'sintetico@exemplo.test',
        finalidade: 'pessoal',
        principal: true,
        aceitaComunicacao: true,
        aceiteEm: '2026-01-10' as string | null,
        ativo: true,
      },
    ],
  };
  const responsaveis = {
    itens: [] as unknown[],
    pendencias: [{ pendencia: 'menor-sem-representante', vinculo: null }] as unknown[],
  };
  await page.route('**/api/cadastros/ficha-complementar/tipos', (r) =>
    json(r, {
      endereco: [{ id: 1, descricao: 'Residencial' }],
      telefone: [{ id: 2, descricao: 'Celular' }],
      parentesco: [{ id: 3, descricao: 'Mãe' }],
    }),
  );
  await page.route(`**/api/cadastros/pacientes/${PACIENTE}/**`, (rota) => {
    const req = rota.request();
    const caminho = new URL(req.url()).pathname.replace(`/api/cadastros/pacientes/${PACIENTE}/`, '');
    if (req.method() === 'GET') {
      if (caminho === 'contatos') return json(rota, contatos);
      if (caminho === 'responsaveis') return json(rota, responsaveis);
      return rota.fallback();
    }
    const corpo = (req.postDataJSON() ?? {}) as Record<string, unknown>;
    pedidos.push({ caminho, corpo });
    if (caminho === 'telefones') {
      contatos.telefones.push({
        id: 21,
        tipo: 'Celular',
        ddi: '55',
        ddd: corpo['ddd'] ?? null,
        numero: String(corpo['numero']),
        nomeContato: null,
        principal: true,
        aceitaMensagem: corpo['aceitaMensagem'] === true,
        ativo: true,
      });
      return json(rota, { id: 21 }, 201);
    }
    if (caminho === 'contatos/email/31/revogar-aceite') {
      contatos.emails[0] = { ...contatos.emails[0]!, aceitaComunicacao: false, aceiteEm: null };
      return json(rota, { id: 31 });
    }
    if (caminho === 'responsaveis') {
      responsaveis.itens.push({
        id: 41,
        nome: String(corpo['nome']),
        cpfFinal: '01',
        papel: String(corpo['papel']),
        parentesco: 'Mãe',
        autorizarProcedimento: corpo['autorizarProcedimento'] === true,
        receberInformacao: corpo['receberInformacao'] === true,
        retirarDocumento: corpo['retirarDocumento'] === true,
        contatoPrincipal: false,
        vigenciaInicio: '2026-01-20',
        vigenciaFim: null,
        vigente: true,
        temComprovante: false,
      });
      responsaveis.pendencias = [];
      return json(rota, { id: 41 }, 201);
    }
    return json(rota, { id: 1 });
  });
}

test.describe('Ficha complementar e regras de campo do cadastro @F31', () => {
  test('contatos: telefone com validação na hora, aceite do e-mail retirado sem encerrar; axe', async ({
    page,
  }) => {
    const pedidos: Pedido[] = [];
    await entrar(page, 'SINT.RECEPCAO');
    await simularFicha(page, pedidos);
    await page.goto(`/cadastros/pacientes/${PACIENTE}/contatos`);
    await expect(page.getByTestId('endereco-11')).toContainText('RUA SINTETICA');
    await expect(page.getByTestId('email-31')).toContainText('10/01/2026');

    // Telefone curto: o erro aparece na hora e o pedido não sai.
    const formTel = page.getByTestId('form-telefone');
    await escolher(page.getByTestId('telefone-tipo'), { rotulo: 'Celular' });
    await formTel.getByLabel('DDD').fill('11');
    await page.getByTestId('telefone-numero').fill('123');
    await expect(formTel.getByRole('alert')).toBeVisible();
    await expect(formTel.getByRole('button', { name: 'Incluir' })).toBeDisabled();
    await page.getByTestId('telefone-numero').fill('999990001');
    await formTel.getByLabel('O titular aceita mensagem neste número').check();
    await formTel.getByRole('button', { name: 'Incluir' }).click();
    await expect(page.getByTestId('telefone-21')).toContainText('999990001');
    expect(pedidos[0]).toMatchObject({
      caminho: 'telefones',
      corpo: { ddd: '11', numero: '999990001', aceitaMensagem: true },
    });

    // E-mail com aceite de comunicação exige a declaração do titular antes de sair.
    const formMail = page.getByTestId('form-email');
    await page.getByTestId('email-endereco').fill('outro@exemplo.test');
    await formMail.getByLabel('Aceita comunicações não obrigatórias').check();
    await expect(formMail.getByRole('alert')).toContainText('declaração do titular');
    await expect(formMail.getByRole('button', { name: 'Incluir' })).toBeDisabled();

    // Retirar o aceite: um clique, o e-mail continua em uso.
    await page.getByTestId('email-revogar-31').click();
    await expect(page.getByTestId('aviso-ficha')).toBeVisible();
    await expect(page.getByTestId('email-31')).not.toContainText('Aceita comunicações');
    await expect(page.getByTestId('email-31')).not.toContainText('fora de uso');
    expect(pedidos.map((p) => p.caminho)).toEqual(['telefones', 'contatos/email/31/revogar-aceite']);
    await semViolacaoAxe(page, '/cadastros/pacientes/:id/contatos');
  });

  test('responsáveis: pendência do menor, poder de autorizar só para quem representa, inclusão; axe', async ({
    page,
  }) => {
    const pedidos: Pedido[] = [];
    await entrar(page, 'SINT.RECEPCAO');
    await simularFicha(page, pedidos);
    await page.goto(`/cadastros/pacientes/${PACIENTE}/contatos`);
    await expect(page.getByTestId('pendencia-responsavel')).toContainText('menor de idade');

    const form = page.getByTestId('form-responsavel');
    await page.getByTestId('responsavel-cpf').fill('123');
    await expect(form.getByRole('alert')).toContainText('11 dígitos');
    await page.getByTestId('responsavel-cpf').fill('000.000.001-91');
    // Familiar não autoriza procedimento: marcar o poder mostra o erro na hora.
    await escolher(page.getByTestId('responsavel-papel'), { rotulo: 'Familiar' });
    await form.getByLabel('Autoriza procedimento').check();
    await expect(form.getByRole('alert')).toContainText('Só responsável legal');
    await expect(form.getByRole('button', { name: 'Incluir' })).toBeDisabled();
    // Responsável legal: os três poderes vêm sugeridos pelo papel.
    await escolher(page.getByTestId('responsavel-papel'), { rotulo: 'Responsável legal' });
    await expect(form.getByLabel('Autoriza procedimento')).toBeChecked();
    await page.getByTestId('responsavel-nome').fill('RESPONSAVEL SINTETICO');
    await form.getByRole('button', { name: 'Incluir' }).click();
    await expect(page.getByTestId('responsavel-41')).toContainText('RESPONSAVEL SINTETICO');
    await expect(page.getByTestId('pendencia-responsavel')).toHaveCount(0);
    expect(pedidos[0]).toMatchObject({
      caminho: 'responsaveis',
      corpo: {
        cpf: '00000000191',
        papel: 'responsavel_legal',
        autorizarProcedimento: true,
        receberInformacao: true,
        retirarDocumento: true,
      },
    });
    await semViolacaoAxe(page, '/cadastros/pacientes/:id/contatos');
  });

  test('regras de campo: campo fixo não vira opcional, gravação com o escopo e inativação; axe', async ({
    page,
  }) => {
    const pedidos: Pedido[] = [];
    interface Regra {
      id: number;
      versao: number;
      campo: string;
      estabelecimento: number | null;
      modulo: number | null;
      tipoAtendimento: string;
      fontePagadora: number | null;
      exigencia: string;
      rotulo: string | null;
      ativo: boolean;
    }
    const itens: Regra[] = [
      {
        id: 51,
        versao: 1,
        campo: 'email',
        estabelecimento: null,
        modulo: null,
        tipoAtendimento: 'todos',
        fontePagadora: null,
        exigencia: 'opcional',
        rotulo: null,
        ativo: true,
      },
    ];
    await entrar(page, 'SINT.ADMIN');
    await page.route('**/api/cadastros/regras-campo**', (rota) => {
      const req = rota.request();
      const caminho = new URL(req.url()).pathname;
      if (req.method() === 'GET') return json(rota, { itens: itens.filter((i) => i.ativo) });
      const corpo = (req.postDataJSON() ?? {}) as Record<string, unknown>;
      pedidos.push({ caminho, corpo });
      if (caminho.endsWith('/inativar')) {
        itens[0] = { ...itens[0]!, ativo: false };
        return json(rota, { id: 51 });
      }
      itens.push({
        id: 52,
        versao: 1,
        campo: String(corpo['campo']),
        estabelecimento: 1,
        modulo: null,
        tipoAtendimento: String(corpo['tipoAtendimento']),
        fontePagadora: Number(corpo['fontePagadora']),
        exigencia: String(corpo['exigencia']),
        rotulo: null,
        ativo: true,
      });
      return json(rota, { id: 52 }, 201);
    });
    await page.goto('/cadastros/regras-campo');
    await expect(page.getByTestId('regra-51')).toContainText('E-mail');
    await expect(page.getByTestId('regra-51')).toContainText('toda a rede');

    await escolher(page.getByTestId('regra-campo'), { rotulo: 'CPF' });
    await escolher(page.getByTestId('regra-exigencia'), { rotulo: 'Opcional' });
    await expect(page.getByTestId('form-regra').getByRole('alert')).toContainText('sempre exigido');
    await expect(page.getByTestId('regra-gravar')).toBeDisabled();

    await escolher(page.getByTestId('regra-campo'), { rotulo: 'Nome da mãe' });
    await escolher(page.getByTestId('regra-exigencia'), { rotulo: 'Obrigatório' });
    await escolher(page.getByTestId('regra-tipo'), { rotulo: 'Internação' });
    await page.getByTestId('regra-fonte').fill('77');
    await page.getByTestId('regra-gravar').click();
    await expect(page.getByTestId('regra-52')).toContainText('Nome da mãe');
    await expect(page.getByTestId('regra-52')).toContainText('fonte 77');
    expect(pedidos[0]?.corpo).toMatchObject({
      campo: 'nomeMae',
      exigencia: 'obrigatorio',
      tipoAtendimento: 'internacao',
      fontePagadora: 77,
      modulo: null,
      todaRede: false,
    });

    await page.getByTestId('regra-inativar-51').click();
    await expect(page.getByTestId('aviso-regra')).toContainText('inativada');
    await expect(page.getByTestId('regra-51')).toHaveCount(0);
    expect(pedidos[1]).toMatchObject({
      caminho: '/api/cadastros/regras-campo/51/inativar',
      corpo: { versao: 1 },
    });
    await semViolacaoAxe(page, '/cadastros/regras-campo');
  });
});
