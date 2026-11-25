// E2E @F3.2-06 (02-AGE L40, ficha F3.2): o painel "Quem vê e quem marca nesta agenda" no detalhe da agenda
// (`/agenda/consultas/agendas/:id`). A lista nominal só existe no banco do cliente (na fonte sintética a API responde
// 503), então este E2E simula `/api/agenda/consultas/agendas/:id/usuarios` e `/usuarios-candidatos` com um estado em
// memória que segue a regra do servidor (a lista nunca fica sem quem marca; liberar retira a lista inteira). O que
// fica no banco é provado nos contratos de efeito `usuarios-agenda.int.spec.ts` (agenda de consulta) e
// `exames/porta-propria.int.spec.ts` (agenda de exame); aqui se prova o fluxo da tela: a agenda aberta vira restrita
// ao incluir o primeiro usuário, a validação na hora (o primeiro tem de marcar; o último que marca não é rebaixado nem
// retirado enquanto houver outros), trocar o acesso num clique, e liberar para todos com confirmação.
// Dados sintéticos. Axe em cada passo.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const AGENDA = 903;

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
const recusa = (rota: Route, codigo: string, detail: string) =>
  rota.fulfill({
    status: 409,
    contentType: 'application/problem+json',
    body: JSON.stringify({ type: `urn:sgh:erro:${codigo}`, title: detail, status: 409, detail, codigo }),
  });

interface Permitido {
  usuario: number;
  login: string;
  nome: string;
  podeMarcar: boolean;
}

const CANDIDATOS = [
  { usuario: 7001, login: 'sint.central.a', nome: 'ATENDENTE SINTETICA A' },
  { usuario: 7002, login: 'sint.central.b', nome: 'ATENDENTE SINTETICO B' },
];

test.describe('agenda: usuários permitidos por agenda @F3.2-06 @fase3', () => {
  test.setTimeout(180_000);

  test('agenda aberta vira restrita; o primeiro tem de marcar; o último que marca fica travado; trocar acesso e liberar para todos; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    let lista: Permitido[] = [];
    const gravacoes: unknown[] = [];

    await page.route('**/api/agenda/consultas/usuarios-candidatos*', (rota) => {
      const termo = (new URL(rota.request().url()).searchParams.get('termo') ?? '').toUpperCase();
      return json(
        rota,
        CANDIDATOS.filter((c) => c.nome.includes(termo) || c.login.toUpperCase().includes(termo)),
      );
    });
    await page.route(`**/api/agenda/consultas/agendas/${AGENDA}/usuarios`, (rota) => {
      if (rota.request().method() === 'GET')
        return json(rota, {
          agenda: AGENDA,
          restrita: lista.length > 0,
          usuarios: lista,
          // Quem mantém a lista sem estar nela é o gestor de agendas.
          meuAcesso: lista.length > 0 ? 'gestor' : 'livre',
        });
      const m = rota.request().postDataJSON() as {
        acao: string;
        usuario?: number;
        podeMarcar?: boolean;
      };
      gravacoes.push(m);
      let nova: Permitido[];
      if (m.acao === 'liberarTodos') nova = [];
      else if (m.acao === 'incluir') {
        const c = CANDIDATOS.find((x) => x.usuario === m.usuario);
        if (!c) return recusa(rota, 'usuario-inexistente', 'O usuário não existe ou foi desativado.');
        nova = [...lista, { ...c, podeMarcar: m.podeMarcar === true }];
      } else if (m.acao === 'alterar')
        nova = lista.map((p) => (p.usuario === m.usuario ? { ...p, podeMarcar: m.podeMarcar === true } : p));
      else nova = lista.filter((p) => p.usuario !== m.usuario);
      if (nova.length > 0 && !nova.some((p) => p.podeMarcar))
        return recusa(
          rota,
          'lista-sem-quem-marca',
          'Ninguém mais marcaria na agenda: deixe ao menos um usuário que marca, ou libere a agenda para todos.',
        );
      lista = nova;
      const mensagem: Record<string, string> = {
        incluir: 'Usuário incluído na lista da agenda.',
        alterar: 'Acesso do usuário na agenda alterado.',
        remover: 'Usuário retirado da lista da agenda.',
        liberarTodos: 'Agenda liberada para todos do escopo.',
      };
      return json(rota, {
        ok: true,
        resultado: { agenda: AGENDA, usuarios: lista.length },
        repetida: false,
        mensagem: mensagem[m.acao],
      });
    });

    await entrar(page, 'SINT.AGENDA');
    await page.goto(`/agenda/consultas/agendas/${AGENDA}`);
    const painel = page.getByTestId('agenda-usuarios');
    await expect(painel).toBeVisible();
    const situacao = page.getByTestId('agenda-usuarios-situacao');
    const mensagem = page.getByTestId('agenda-usuarios-mensagem');
    const incluir = painel.getByRole('button', { name: 'Incluir na lista' });
    const podeMarcar = painel.getByRole('switch', { name: 'Pode marcar' });

    // Agenda aberta: sem lista, vale o cargo; nada a incluir enquanto não se escolhe o usuário.
    await expect(situacao).toContainText('Agenda aberta');
    await expect(painel).toContainText('Seu acesso: pelo cargo');
    await expect(page.getByTestId('agenda-usuarios-lista')).toHaveCount(0);
    await expect(incluir).toBeDisabled();
    await semViolacaoAxe(page, 'usuários da agenda: aberta');

    // O primeiro da lista precisa marcar: com "Pode marcar" desligado a tela nem deixa enviar.
    await painel.getByLabel('Buscar usuário (nome ou login)').fill('ATENDENTE');
    await escolher(painel.getByLabel('Usuário encontrado'), '7001');
    await expect(incluir).toBeEnabled();
    await podeMarcar.click();
    await expect(podeMarcar).toHaveAttribute('aria-checked', 'false');
    await expect(incluir).toBeDisabled();
    await podeMarcar.click();
    await incluir.click();
    await expect(mensagem).toContainText('Usuário incluído na lista da agenda.');
    await expect(situacao).toContainText('Agenda restrita');
    await expect(painel).toContainText('Seu acesso: gestor de agendas');
    const linhas = page.getByTestId('agenda-usuarios-lista').locator('tbody tr');
    await expect(linhas).toHaveCount(1);
    await expect(linhas.nth(0)).toContainText('ATENDENTE SINTETICA A (sint.central.a)');
    await expect(linhas.nth(0)).toContainText('Vê e marca');

    // O segundo entra só para consulta (quem já está na lista some das opções).
    await painel.getByLabel('Buscar usuário (nome ou login)').fill('ATENDENTE');
    await podeMarcar.click();
    await escolher(painel.getByLabel('Usuário encontrado'), '7002');
    await incluir.click();
    await expect(linhas).toHaveCount(2);
    const linhaA = linhas.filter({ hasText: 'sint.central.a' });
    const linhaB = linhas.filter({ hasText: 'sint.central.b' });
    await expect(linhaB).toContainText('Só consulta');
    // A única que marca não é rebaixada nem retirada enquanto houver outro na lista.
    await expect(
      linhaA.getByRole('button', { name: 'Passar ATENDENTE SINTETICA A para só consulta' }),
    ).toBeDisabled();
    await expect(linhaA.getByRole('button', { name: 'Retirar ATENDENTE SINTETICA A' })).toBeDisabled();
    await semViolacaoAxe(page, 'usuários da agenda: restrita');

    // Trocar o acesso num clique: B passa a marcar e A pode então ficar só em consulta.
    await linhaB.getByRole('button', { name: 'Permitir que ATENDENTE SINTETICO B marque' }).click();
    await expect(mensagem).toContainText('Acesso do usuário na agenda alterado.');
    await expect(linhaB).toContainText('Vê e marca');
    await linhaA.getByRole('button', { name: 'Passar ATENDENTE SINTETICA A para só consulta' }).click();
    await expect(linhaA).toContainText('Só consulta');

    // Retirar pede confirmação; o histórico fica (a retirada é lógica no servidor).
    await linhaA.getByRole('button', { name: 'Retirar ATENDENTE SINTETICA A' }).click();
    await expect(page.getByTestId('confirmacao')).toContainText('O histórico fica registrado');
    await page.getByTestId('confirmacao').getByRole('button', { name: 'Confirmar' }).click();
    await expect(mensagem).toContainText('Usuário retirado da lista da agenda.');
    await expect(linhas).toHaveCount(1);

    // Liberar para todos: a lista sai inteira e a agenda volta a valer pelo cargo.
    await painel.getByRole('button', { name: 'Liberar para todos' }).click();
    await page.getByTestId('confirmacao').getByRole('button', { name: 'Confirmar' }).click();
    await expect(mensagem).toContainText('Agenda liberada para todos do escopo.');
    await expect(situacao).toContainText('Agenda aberta');
    await expect(page.getByTestId('agenda-usuarios-lista')).toHaveCount(0);
    await semViolacaoAxe(page, 'usuários da agenda: liberada');

    expect(gravacoes).toEqual([
      { acao: 'incluir', usuario: 7001, podeMarcar: true },
      { acao: 'incluir', usuario: 7002, podeMarcar: false },
      { acao: 'alterar', usuario: 7002, podeMarcar: true },
      { acao: 'alterar', usuario: 7001, podeMarcar: false },
      { acao: 'remover', usuario: 7001 },
      { acao: 'liberarTodos' },
    ]);
    expect(externas).toEqual([]);
  });
});
