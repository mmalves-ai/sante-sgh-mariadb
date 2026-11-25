// E2E @C2-028 (F7, 03-PEP L132): documentos exigidos por diagnóstico, idade ou setor. As rotas
// `/api/pep/documentos-exigidos/*` só existem no banco do cliente (na fonte sintética respondem 503), então este E2E
// simula essas rotas com um estado em memória que segue a regra do servidor (a regra desativada fica na lista, pela
// versão; nada é apagado). O que fica no banco está no contrato de efeito
// apps/api/src/modulos/pep/obrigatoriedade-documento-propria.int.spec.ts. Aqui se prova o fluxo: a lista do
// profissional por paciente com a pendência vencida e bloqueante primeiro, o filtro das vencidas, a faixa etária
// invertida recusada na hora (gravar desabilitado), a inclusão da regra com CID e a desativação pela versão. Axe na
// tela. Massa SINTÉTICA.
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

const pend = (regra: number, titulo: string, vencida: boolean, exigencia: 'bloquear' | 'alertar') => ({
  regra,
  modelo: regra + 100,
  titulo,
  momento: 'admissao',
  exigencia,
  exigidoDesde: '2030-03-10T08:00:00.000Z',
  prazo: '2030-03-10T20:00:00.000Z',
  vencida,
  motivo: vencida ? 'CID I21 do atendimento' : 'setor UTI FICTICIA',
});

function simular(page: Page) {
  const corpos: Record<string, unknown>[] = [];
  const itens = [
    {
      atendimento: 11,
      numero: 'AT-FIC-11',
      paciente: 501,
      pacienteNome: 'PACIENTE FICTICIO A',
      prontuario: '9011',
      setor: 3,
      setorNome: 'UTI FICTICIA',
      pendencias: [pend(2, 'ESCALA FICTICIA', false, 'alertar')],
    },
    {
      atendimento: 12,
      numero: 'AT-FIC-12',
      paciente: 502,
      pacienteNome: 'PACIENTE FICTICIO B',
      prontuario: '9012',
      setor: 4,
      setorNome: 'CLINICA FICTICIA',
      pendencias: [
        pend(2, 'ESCALA FICTICIA', false, 'alertar'),
        pend(1, 'PROTOCOLO FICTICIO DE DOR TORACICA', true, 'bloquear'),
      ],
    },
  ];
  // A regra de todos os estabelecimentos criada em outro estabelecimento: aparece só para leitura.
  const regras: Record<string, unknown>[] = [
    {
      id: 39,
      versao: 1,
      ativo: true,
      titulo: 'PROTOCOLO FICTICIO DE DOR TORACICA',
      modelo: 101,
      setor: null,
      setorNome: null,
      editavel: false,
      todosEstabelecimentos: true,
      sexo: null,
      tipoAtendimento: 'todos',
      idadeMinimaDias: null,
      idadeMaximaDias: null,
      cids: [],
      momento: 'alta',
      exigencia: 'alertar',
      prazoMinutos: null,
      intervaloDias: null,
      vigenciaInicio: '2026-01-01',
      vigenciaFim: null,
    },
  ];
  const opcoes = {
    modelos: [{ id: 101, rotulo: 'PROTOCOLO FICTICIO DE DOR TORACICA' }],
    setores: [{ id: 3, rotulo: 'UTI FICTICIA' }],
    sexos: [{ id: 1, rotulo: 'Feminino' }],
  };
  const lista = (url: URL) => {
    const so = url.searchParams.get('vencidas') === '1';
    const setor = url.searchParams.get('setor');
    const sel = itens
      .filter((a) => !setor || a.setor === Number(setor))
      .map((a) => ({ ...a, pendencias: so ? a.pendencias.filter((p) => p.vencida) : a.pendencias }))
      .filter((a) => a.pendencias.length);
    const todas = sel.flatMap((a) => a.pendencias);
    return {
      agora: '2030-03-10T21:00:00.000Z',
      regrasAtivas: 2,
      totais: {
        atendimentos: sel.length,
        pendencias: todas.length,
        vencidas: todas.filter((p) => p.vencida).length,
        bloqueantes: todas.filter((p) => p.exigencia === 'bloquear').length,
      },
      itens: sel,
    };
  };
  return {
    corpos,
    async ligar() {
      await page.route(/\/api\/pep\/documentos-exigidos\/pendencias/, (rota) =>
        json(rota, lista(new URL(rota.request().url()))),
      );
      await page.route('**/api/pep/documentos-exigidos/regras', async (rota) => {
        if (rota.request().method() === 'GET') return json(rota, { regras, opcoes });
        const c = rota.request().postDataJSON() as Record<string, unknown>;
        corpos.push(c);
        const id = 39 + regras.length;
        regras.push({
          id,
          versao: 1,
          ativo: true,
          titulo: opcoes.modelos.find((m) => m.id === c['modelo'])!.rotulo,
          setorNome: c['setor'] ? 'UTI FICTICIA' : null,
          editavel: true,
          ...c,
          cids: (c['cids'] as string[]).map((x) => x.replace('.', '').toUpperCase()),
        });
        return json(rota, { tabela: 'regra', id, cids: (c['cids'] as string[]).length });
      });
      await page.route('**/api/pep/documentos-exigidos/regras/*/ativo', async (rota) => {
        const id = Number(rota.request().url().split('/regras/')[1]!.split('/')[0]);
        const c = rota.request().postDataJSON() as { versao: number; ativo: boolean };
        corpos.push(c);
        const r = regras.find((x) => x['id'] === id)!;
        if (r['versao'] !== c.versao) return json(rota, { status: 409, title: 'Versão' }, 409);
        r['ativo'] = c.ativo;
        r['versao'] = c.versao + 1;
        return json(rota, { id, ativo: c.ativo });
      });
    },
  };
}

test.describe('@C2-028 documentos exigidos por diagnóstico, idade ou setor', () => {
  test('o profissional vê o que falta por paciente e a administração mantém as regras com a validação na hora', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const api = simular(page);
    await api.ligar();
    await entrar(page, 'SINT.ADMIN');

    await page.goto('/pep/documentos-exigidos');
    await expect(page.getByTestId('documentos-exigidos')).toBeVisible();
    await expect(page.getByTestId('docexig-totais')).toContainText('2 atendimento(s)');
    await expect(page.getByTestId('docexig-totais')).toContainText('1 vencido(s)');

    // O paciente com a vencida bloqueante vem primeiro, e nele a vencida bloqueante encabeça a lista.
    const lista = page.getByTestId('docexig-lista');
    await expect(lista.locator(':scope > li').first()).toHaveAttribute(
      'data-testid',
      'docexig-atendimento-12',
    );
    const doB = page.getByTestId('docexig-atendimento-12').locator('ul > li');
    await expect(doB.first()).toHaveAttribute('data-testid', 'docexig-pendencia-12-1');
    await expect(doB.first()).toHaveAttribute('data-vencida', 'true');
    await expect(doB.first()).toHaveAttribute('data-exigencia', 'bloquear');
    await expect(doB.first()).toContainText('PROTOCOLO FICTICIO DE DOR TORACICA');
    await expect(page.getByTestId('docexig-abrir-12')).toHaveAttribute('href', '/pep/prontuario/502');

    // Só as vencidas: o paciente sem vencida sai da lista.
    await page.getByTestId('docexig-vencidas').check();
    await expect(page.getByTestId('docexig-atendimento-11')).toHaveCount(0);
    await expect(page.getByTestId('docexig-atendimento-12')).toBeVisible();
    await page.getByTestId('docexig-vencidas').uncheck();
    await escolher(page.getByTestId('docexig-setor'), '3');
    await expect(page.getByTestId('docexig-atendimento-12')).toHaveCount(0);
    await expect(page.getByTestId('docexig-atendimento-11')).toBeVisible();
    await semViolacaoAxe(page, '/pep/documentos-exigidos');

    // Regras: a regra de todos os estabelecimentos criada em outro fica só para leitura.
    await page.getByTestId('docexig-aba-regras').click();
    await expect(page.getByTestId('docexig-regra-39')).toContainText('Vale para todos os estabelecimentos');
    await expect(page.getByTestId('docexig-regra-editar-39')).toHaveCount(0);
    await expect(page.getByTestId('docexig-regra-alternar-39')).toHaveCount(0);

    // A regra de todos os estabelecimentos não aceita setor: recusada na hora.
    await escolher(page.getByTestId('docexig-modelo'), '101');
    await escolher(page.getByTestId('docexig-regra-setor'), '3');
    await page.getByTestId('docexig-todos-est').check();
    await expect(page.getByTestId('docexig-problema').first()).toContainText('não pode ter setor');
    await expect(page.getByTestId('docexig-gravar')).toBeDisabled();
    await page.getByTestId('docexig-todos-est').uncheck();

    // A faixa etária invertida é recusada na hora e o gravar fica desabilitado.
    await escolher(page.getByTestId('docexig-modelo'), '101');
    await escolher(page.getByTestId('docexig-exigencia'), 'bloquear');
    await page.getByTestId('docexig-idade-min').locator('input').fill('65');
    await page.getByTestId('docexig-idade-max').locator('input').fill('18');
    await expect(page.getByTestId('docexig-problema').first()).toContainText('idade mínima passa da máxima');
    await expect(page.getByTestId('docexig-gravar')).toBeDisabled();

    // Corrigida a faixa, com CID e prazo, a regra entra.
    await page.getByTestId('docexig-idade-min').locator('input').fill('18');
    await page.getByTestId('docexig-idade-max').locator('input').fill('');
    await page.getByTestId('docexig-cids').locator('input, textarea').first().fill('I21, i20.0');
    await page.getByTestId('docexig-prazo').locator('input').fill('2');
    await escolher(page.getByTestId('docexig-regra-setor'), '3');
    await expect(page.getByTestId('docexig-problema')).toHaveCount(0);
    await page.getByTestId('docexig-gravar').click();
    await expect(page.getByTestId('docexig-regra-40')).toContainText('PROTOCOLO FICTICIO DE DOR TORACICA');
    await expect(page.getByTestId('docexig-regra-40')).toContainText('I21');
    expect(api.corpos.at(-1)).toMatchObject({
      modelo: 101,
      setor: 3,
      exigencia: 'bloquear',
      momento: 'admissao',
      idadeMinimaDias: 6575,
      idadeMaximaDias: null,
      cids: ['I21', 'i20.0'],
      prazoMinutos: 120,
      intervaloDias: null,
    });

    // Desativar: a regra fica na lista, inativa, pela versão.
    await page.getByTestId('docexig-regra-alternar-40').click();
    await expect(page.getByTestId('docexig-regra-40')).toHaveAttribute('data-ativo', 'false');
    expect(api.corpos.at(-1)).toEqual({ versao: 1, ativo: false });
    await semViolacaoAxe(page, '/pep/documentos-exigidos');
    expect(externas).toEqual([]);
  });
});
