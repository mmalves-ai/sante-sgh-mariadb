// E2E @M50.3 (ficha do M50, seções 7 e 10, na parte da etapa 3): o portal do médico externo.
//   - o médico pede o acesso no portal (autocadastro com o segundo fator); a equipe aprova e, na tela interna do portal
//     do médico externo, liga a conta ao cadastro do corpo clínico sugerido pelo número e pela UF do conselho;
//   - o médico, em outro navegador (sem sessão interna), entra no portal com a senha e o código do autenticador, abre a
//     agenda cirúrgica (só as cirurgias dele, o paciente mascarado) e o extrato de produção e repasse;
//   - pede uma cirurgia (o paciente como ele informa): o pedido fica "Solicitado", sem ocupar a sala;
//   - a secretaria do bloco vê o pedido do portal no mapa e, ao confirmar, a busca do cadastro já começa pelo nome
//     informado;
//   - o médico retira o próprio pedido; a sessão do portal não abre as telas internas.
// axe sem violação séria nas telas; nenhuma requisição externa. Sessão real sobre a fonte sintética de dev e as portas
// em MEMÓRIA (contas, corpo clínico, agenda e repasse SINTÉTICOS).
import { createHmac } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const SENHA_MEDICO = 'senha-longa-sintetica-m503';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

/** O código do aplicativo autenticador (TOTP de 30 s, 6 dígitos, SHA-1), como o do celular do médico. */
function totp(segredoBase32: string, agora = Date.now()): string {
  const ALF = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of segredoBase32.replace(/=+$/, '').toUpperCase())
    bits += ALF.indexOf(c).toString(2).padStart(5, '0');
  const bytes = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
  const passo = Buffer.alloc(8);
  passo.writeBigUInt64BE(BigInt(Math.floor(agora / 1000 / 30)));
  const h = createHmac('sha1', bytes).update(passo).digest();
  const o = h[h.length - 1]! & 0xf;
  const n = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(n % 1_000_000).padStart(6, '0');
}

const emDias = (k: number) => {
  const d = new Date();
  d.setDate(d.getDate() + k);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

test.describe('portal do médico externo, etapa 3: vínculo, agenda, extrato e pedido de cirurgia @M50.3', () => {
  test.setTimeout(300_000);

  test('autocadastro → aprovação e vínculo ao corpo clínico → agenda e extrato no portal → pedido → mapa do bloco → retirada; axe', async ({
    page,
    browser,
  }) => {
    const externas = vigiarExternas(page);
    const contexto = await browser.newContext();
    const med = await contexto.newPage();
    const externasMed = vigiarExternas(med);

    // O médico pede o acesso (autocadastro com o segundo fator).
    // O estabelecimento do endereço chega antes do envio (navegador novo: a primeira carga é mais lenta).
    const padrao = med.waitForResponse((r) => r.url().endsWith('/api/portal/estabelecimento'));
    await med.goto('/medico/cadastro');
    await padrao;
    await med.getByTestId('medico-nome').fill('Cirurgiao Externo Sintetico');
    await med.getByTestId('medico-uf').fill('SP');
    await med.getByTestId('medico-numero').fill('54321');
    await med.getByTestId('medico-email').fill('cirurgiao.portal@exemplo.invalid');
    await med.getByTestId('medico-senha').fill(SENHA_MEDICO);
    await med.getByTestId('medico-aceite').check();
    await med.getByTestId('medico-enviar').click();
    const otpauth = (await med.getByTestId('medico-otpauth').locator('code').textContent()) ?? '';
    const segredo = new URL(otpauth).searchParams.get('secret')!;

    // A equipe aprova o autocadastro e liga a conta ao cadastro do corpo clínico sugerido.
    await entrar(page, 'SINT.RECEPCAO.SADT');
    await page.goto('/sadt/solicitantes/autocadastro');
    await escolher(page.getByTestId('autocadastro-candidato-54321'), { indice: 1 });
    await page.getByTestId('autocadastro-aprovar-54321').click();
    await expect(page.getByTestId('autocadastro-mensagem')).toContainText('aprovado');
    await page.goto('/portais/medico-externo');
    await expect(page.getByTestId('tela-portal-medico-interno')).toBeVisible();
    await expect(page.getByTestId('pmi-conta-54321')).toBeVisible();
    await semViolacaoAxe(page, '/portais/medico-externo');
    await escolher(page.getByTestId('pmi-profissional-54321'), { rotulo: 'CIRURGIAO SINTETICO A' });
    await page.getByTestId('pmi-ligar-54321').click();
    await expect(page.getByTestId('pmi-mensagem')).toContainText('ligada');
    await expect(page.getByTestId('pmi-ligado-54321')).toContainText('CIRURGIAO SINTETICO A');

    // O médico entra no portal e abre a agenda cirúrgica (só as dele, o paciente mascarado).
    await med.goto('/resultados');
    await escolher(med.getByTestId('portal-perfil'), 'medicoExterno');
    await med.getByTestId('portal-uf').fill('SP');
    await med.getByTestId('portal-numero').fill('54321');
    await med.getByTestId('portal-senha').fill(SENHA_MEDICO);
    await med.getByTestId('portal-codigo').fill(totp(segredo));
    await med.getByTestId('portal-entrar').click();
    await expect(med.getByTestId('portal-sessao')).toBeVisible();
    await med.getByTestId('portal-medico-agenda').click();
    await expect(med).toHaveURL(/\/medico-externo\/agenda/);
    await expect(med.getByTestId('pm-agendamentos')).toContainText('COLECISTECTOMIA');
    await expect(med.getByTestId('pm-agendamentos')).not.toContainText('SINTETICO SALA');
    await semViolacaoAxe(med, '/medico-externo/agenda');

    // Pede uma cirurgia: fica solicitada, sem ocupar a sala.
    const data = emDias(9);
    await med.getByTestId('pm-nome').fill('Paciente Informado Sintetico');
    await med.getByTestId('pm-nascimento').fill('1970-05-02');
    await escolher(med.getByTestId('pm-sala'), { indice: 2 });
    await med.getByTestId('pm-data').fill(data);
    await med.getByTestId('pm-hora').fill('1400');
    await med.getByTestId('pm-duracao').fill('90');
    await med.getByTestId('pm-procedimento').fill('COLE');
    await med.getByRole('button', { name: 'Buscar procedimento' }).click();
    await med.getByTestId('pm-proc-30101271').click();
    await escolher(med.getByTestId('pm-convenio'), { indice: 1 });
    await med.getByTestId('pm-pedir').click();
    await expect(med.getByTestId('pm-mensagem')).toContainText('Cirurgia pedida');
    await expect(med.getByTestId('pm-pedidos')).toContainText('PACIENTE INFORMADO SINTETICO');
    await expect(med.getByTestId('pm-pedidos')).toContainText('Solicitado');

    // O extrato de produção e repasse (os códigos do profissional ligado).
    await med.getByTestId('portal-medico-menu-extrato').click();
    await expect(med).toHaveURL(/\/medico-externo\/extrato/);
    await expect(med.getByTestId('pm-profissional')).toContainText('CIRURGIAO SINTETICO A');
    await expect(med.getByTestId('pm-total')).toBeVisible();
    await semViolacaoAxe(med, '/medico-externo/extrato');

    // A sessão do portal não abre as telas internas.
    await med.goto('/portais/medico-externo');
    await expect(med).toHaveURL(/\/(entrar|sem-permissao)/);
    await expect(med.getByTestId('tela-portal-medico-interno')).toHaveCount(0);

    // A secretaria do bloco vê o pedido do portal no mapa; ao confirmar, a busca começa pelo nome informado.
    await entrar(page, 'SINT.BLOCO');
    await page.goto('/cirurgia/mapa');
    await page.getByTestId('mapa-inicio').fill(data);
    await page.getByRole('button', { name: 'Ver o mapa' }).click();
    await expect(page.getByTestId('lista-solicitacoes')).toContainText(
      'pedido pelo portal do médico externo',
    );
    await expect(page.getByTestId('lista-solicitacoes')).toContainText('PACIENTE I. S.');
    await page.getByRole('button', { name: 'Confirmar na sala' }).first().click();
    await expect(page.getByTestId('pedido-termo')).toHaveValue('PACIENTE INFORMADO SINTETICO');
    // O cirurgião do pedido (o registro do conselho, que ainda não atuou no bloco) já vem escolhido.
    await expect(page.getByTestId('pedido-cirurgiao')).toHaveAttribute('data-valor', '5102:54321');
    await semViolacaoAxe(page, '/cirurgia/mapa (pedido do portal)');

    // O médico retira o próprio pedido ainda não confirmado.
    await med.goto('/medico-externo/agenda');
    const retirar = med.locator('[data-testid^="pm-retirar-"]').first();
    await retirar.click();
    await med.getByTestId('confirmacao').getByRole('button', { name: 'Confirmar' }).click();
    await expect(med.getByTestId('pm-mensagem')).toContainText('Pedido retirado');
    await expect(med.getByTestId('pm-pedidos')).toContainText('Cancelado');

    expect(externas).toEqual([]);
    expect(externasMed).toEqual([]);
    await contexto.close();
  });
});
