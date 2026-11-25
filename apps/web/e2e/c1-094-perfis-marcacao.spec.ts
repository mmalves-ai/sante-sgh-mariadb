// E2E @C1-094 (F8, 02-AGE linha 46): perfis de marcação pelo caminho da tela (`/agenda/consultas/perfis-marcacao`).
// O gestor de agendas cria o perfil com recortes (convênio permitido e uma agenda como exceção), vê a validação na
// hora (código inválido, recorte repetido não aparece no combo), inclui um usuário com vigência (a vigência invertida
// é recusada na hora) e o retira com confirmação. Os perfis só existem no banco do cliente (na fonte sintética a API
// responde 503): as respostas são simuladas pelo Playwright com massa SINTÉTICA, no contrato do servidor. O efeito no
// banco e a trava na marcação estão em apps/api/src/modulos/agenda/perfil-marcacao.int.spec.ts.
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

const OPCOES = {
  fonte_pagadora: [
    { id: 9401, nome: 'CONVENIO SINTETICO A' },
    { id: 9402, nome: 'CONVENIO SINTETICO B' },
  ],
  especialidade: [{ id: 9411, nome: 'ESPECIALIDADE SINTETICA' }],
  setor: [{ id: 9421, nome: 'SETOR SINTETICO' }],
  agenda: [{ id: 9431, nome: 'AGENDA SINTETICA C1094' }],
  profissional: [{ id: 9441, nome: 'PROFISSIONAL SINTETICO' }],
  estabelecimento: [{ id: 9451, nome: 'HOSPITAL SINTETICO' }],
};
const NOMES = new Map(
  Object.entries(OPCOES).flatMap(([d, xs]) => xs.map((x) => [`${d}:${x.id}`, x.nome] as const)),
);

interface Perfil {
  id: number;
  codigo: string;
  descricao: string;
  tipoPerfil: string;
  permiteEncaixe: boolean;
  ativo: boolean;
  versao: number;
  recortes: { dimensao: string; alvo: number; permitido: boolean; nome: string }[];
  usuarios: {
    usuario: number;
    login: string;
    nome: string;
    vigenciaInicio: string | null;
    vigenciaFim: string | null;
  }[];
}

function simular(page: Page) {
  const st = { perfis: [] as Perfil[], corpos: [] as { url: string; corpo: Record<string, unknown> }[] };
  void page.route('**/api/agenda/perfis-marcacao/opcoes', (r) => json(r, OPCOES));
  void page.route('**/api/agenda/consultas/usuarios-candidatos*', (r) =>
    json(r, [{ usuario: 7101, login: 'sint.central.c1094', nome: 'ATENDENTE SINTETICA C1094' }]),
  );
  void page.route('**/api/agenda/perfis-marcacao**', (r) => {
    const url = new URL(r.request().url());
    if (url.pathname.endsWith('/opcoes')) return r.fallback();
    if (r.request().method() === 'GET') return json(r, st.perfis);
    const corpo = r.request().postDataJSON() as Record<string, unknown>;
    st.corpos.push({ url: url.pathname, corpo });
    const m = /perfis-marcacao(?:\/(\d+))?(\/usuarios)?$/.exec(url.pathname);
    const id = m?.[1] ? Number(m[1]) : null;
    if (m?.[2]) {
      const p = st.perfis.find((x) => x.id === id)!;
      if (corpo['acao'] === 'remover') p.usuarios = p.usuarios.filter((u) => u.usuario !== corpo['usuario']);
      else
        p.usuarios.push({
          usuario: Number(corpo['usuario']),
          login: 'sint.central.c1094',
          nome: 'ATENDENTE SINTETICA C1094',
          vigenciaInicio: (corpo['vigenciaInicio'] as string | null) ?? null,
          vigenciaFim: (corpo['vigenciaFim'] as string | null) ?? null,
        });
      return json(r, {
        ok: true,
        resultado: { perfil: p.id, usuarios: p.usuarios.length },
        repetida: false,
        mensagem: corpo['acao'] === 'remover' ? 'Usuário retirado do perfil.' : 'Usuário no perfil.',
      });
    }
    const recortes = (corpo['recortes'] as { dimensao: string; alvo: number; permitido: boolean }[]).map(
      (x) => ({ ...x, nome: NOMES.get(`${x.dimensao}:${x.alvo}`) ?? `#${x.alvo}` }),
    );
    const dados = {
      codigo: String(corpo['codigo']).toUpperCase(),
      descricao: String(corpo['descricao']),
      tipoPerfil: String(corpo['tipoPerfil']),
      permiteEncaixe: Boolean(corpo['permiteEncaixe']),
      ativo: Boolean(corpo['ativo']),
      recortes,
    };
    let p = st.perfis.find((x) => x.id === id);
    // Como o servidor: alteração com versão velha (outro gestor gravou antes) é recusada.
    if (p && corpo['versao'] !== p.versao)
      return json(
        r,
        { type: 'about:blank', title: 'Conflito de versão', status: 409, codigo: 'conflito-versao' },
        409,
      );
    if (p) Object.assign(p, dados, { versao: p.versao + 1 });
    else st.perfis.push((p = { id: 9490 + st.perfis.length + 1, versao: 1, usuarios: [], ...dados }));
    return json(r, {
      ok: true,
      resultado: { perfil: p.id, recortes: recortes.length },
      repetida: false,
      mensagem: id ? 'Perfil de marcação gravado.' : 'Perfil de marcação criado.',
    });
  });
  return st;
}

test.describe('agenda: perfis de marcação @C1-094 @fase8', () => {
  test.setTimeout(180_000);

  test('cria o perfil com recortes e exceção, valida na hora, inclui e retira usuário com vigência; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const st = simular(page);
    await entrar(page, 'SINT.AGENDA');
    await page.goto('/agenda/consultas/perfis-marcacao');
    const tela = page.getByTestId('perfis-marcacao');
    await expect(page.getByTestId('perfis-marcacao-vazio')).toBeVisible();
    await semViolacaoAxe(page, 'perfis de marcação: vazio');

    await page.getByTestId('perfis-marcacao-novo').click();
    const ed = page.getByTestId('perfil-marcacao-edicao');
    // Validação na hora (regra do domínio): código com espaço não grava.
    await ed.getByLabel('Código').fill('central sint');
    await ed.getByLabel('Descrição').fill('Central sintética C1094');
    await expect(page.getByTestId('perfil-recusa')).toContainText('código');
    await expect(page.getByTestId('perfil-gravar')).toBeDisabled();
    await ed.getByLabel('Código').fill('CENTRAL-SINT');
    await expect(page.getByTestId('perfil-recusa')).toHaveCount(0);
    await escolher(ed.getByLabel('Uso do perfil'), 'central');

    // Recortes: convênio permitido e uma agenda como exceção; o item já usado some do combo.
    await escolher(ed.getByLabel('Recorte por'), 'fonte_pagadora');
    await escolher(ed.getByLabel('Item'), '9401');
    await page.getByTestId('perfil-incluir-recorte').click();
    await escolher(ed.getByLabel('Recorte por'), 'agenda');
    await escolher(ed.getByLabel('Item'), '9431');
    await escolher(ed.getByLabel('Regra'), 'excecao');
    await page.getByTestId('perfil-incluir-recorte').click();
    await expect(page.getByTestId('perfil-recortes')).toContainText('CONVENIO SINTETICO A');
    await expect(page.getByTestId('perfil-recortes')).toContainText('Exceção (não pode)');
    await semViolacaoAxe(page, 'perfis de marcação: edição');
    await page.getByTestId('perfil-gravar').click();
    await expect(page.getByTestId('perfis-marcacao-mensagem')).toHaveText('Perfil de marcação criado.');
    expect(st.corpos[0]!.corpo).toMatchObject({
      codigo: 'CENTRAL-SINT',
      tipoPerfil: 'central',
      recortes: [
        { dimensao: 'fonte_pagadora', alvo: 9401, permitido: true },
        { dimensao: 'agenda', alvo: 9431, permitido: false },
      ],
    });
    await expect(page.getByTestId('perfis-marcacao-lista')).toContainText('CENTRAL-SINT');

    // Usuário com vigência: a invertida é recusada na hora; a válida grava.
    await ed.getByLabel('Buscar usuário (nome ou login)').fill('ATENDENTE');
    await escolher(ed.getByLabel('Usuário encontrado'), '7101');
    await ed.getByLabel('Vale a partir de').fill('10/03/2030');
    // A data se confirma ao sair do campo (SanteData), como o usuário faz.
    await ed.getByLabel('Vale até').fill('01/03/2030');
    await ed.getByLabel('Vale até').press('Tab');
    await expect(ed.getByText('O fim da vigência é antes do início.')).toBeVisible();
    await expect(page.getByTestId('perfil-incluir-usuario')).toBeDisabled();
    await ed.getByLabel('Vale até').fill('31/12/2030');
    await ed.getByLabel('Vale até').press('Tab');
    await page.getByTestId('perfil-incluir-usuario').click();
    await expect(page.getByTestId('perfil-usuarios')).toContainText('ATENDENTE SINTETICA C1094');
    expect(st.corpos[1]!.corpo).toMatchObject({
      acao: 'incluir',
      usuario: 7101,
      vigenciaInicio: '2030-03-10',
      vigenciaFim: '2030-12-31',
    });
    await semViolacaoAxe(page, 'perfis de marcação: usuários');

    // Retirar pede confirmação; o histórico fica (exclusão lógica no servidor).
    await ed.getByRole('button', { name: 'Retirar ATENDENTE SINTETICA C1094' }).click();
    await expect(page.getByTestId('confirmacao')).toContainText('O histórico fica registrado');
    await page.getByTestId('confirmacao').getByRole('button', { name: 'Confirmar' }).click();
    await expect(page.getByTestId('perfis-marcacao-mensagem')).toHaveText('Usuário retirado do perfil.');
    await expect(tela.getByTestId('perfil-usuarios')).toHaveCount(0);
    expect(externas).toEqual([]);
  });
});
