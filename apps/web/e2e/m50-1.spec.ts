// E2E @M50.1 (ficha do M50, seção 10, na parte da etapa 1): "criar conta com 2FA" e "responsável legal de menor".
//   - a recepção abre a ficha do paciente e emite o convite do portal (o código aparece uma vez, para imprimir);
//   - o paciente, em outro navegador (sem sessão interna), faz o primeiro acesso: convite e nascimento (a data errada dá
//     o erro genérico), e-mail, senha e os termos, o QR do aplicativo autenticador e o primeiro código → conta ativa;
//   - vê os resultados liberados e abre um (a visualização fica gravada);
//   - pede o acesso como mãe do filho menor, com o documento (PDF);
//   - a privacidade busca pelo prontuário, confere na tela interna (o documento, o escopo, a senha) e aprova;
//   - a mãe troca de pessoa para o filho, consente pelo representante e abre um pedido do titular; o relatório de quem
//     acessou o próprio prontuário mostra a abertura pelo portal;
//   - a sessão do portal não abre as telas internas.
// axe sem violação séria nas telas; nenhuma requisição externa. Sessão real sobre a fonte sintética de dev e as portas
// em MEMÓRIA (pacientes, resultados e e-mails SINTÉTICOS).
import { createHmac } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
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

/** O código do aplicativo autenticador (TOTP de 30 s, 6 dígitos, SHA-1), como o do celular do paciente. */
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

const PDF = Buffer.from(
  '%PDF-1.4\n% documento sintetico de teste M50.1\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n',
);

test.describe('portal do paciente, etapa 1: conta com segundo fator e responsável legal de menor @M50.1', () => {
  test.setTimeout(300_000);

  test('convite na ficha → primeiro acesso com 2FA → resultados → pedido de responsável → conferência → troca de pessoa, consentimento, pedido e acessos; axe', async ({
    page,
    browser,
  }) => {
    const externas = vigiarExternas(page);
    // A recepção emite o convite na ficha do paciente.
    await entrar(page, 'SINT.RECEPCAO');
    await page.goto('/cadastros/pacientes/1003');
    await expect(page.getByTestId('conta-portal')).toBeVisible();
    await expect(page.getByTestId('conta-portal-sem')).toBeVisible();
    await page.getByTestId('conta-portal-convidar').click();
    const codigo = (await page.getByTestId('conta-portal-codigo').innerText()).trim();
    expect(codigo).toMatch(/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
    await expect(page.getByTestId('conta-portal-situacao')).toContainText('Convidada');
    await semViolacaoAxe(page, '/cadastros/pacientes/1003 (conta do portal)');

    // O paciente, em outro navegador: o primeiro acesso.
    const contexto = await browser.newContext();
    const pac = await contexto.newPage();
    const externasPac = vigiarExternas(pac);
    await pac.goto('/paciente');
    await expect(pac.getByTestId('tela-portal-paciente')).toBeVisible();
    await semViolacaoAxe(pac, '/paciente (entrar)');
    await pac.getByTestId('pac-primeiro-acesso').click();
    await pac.getByTestId('pac-convite').fill(codigo);
    await pac.getByTestId('pac-nascimento').fill('1990-07-02');
    await pac.getByTestId('pac-conferir').click();
    await expect(pac.getByText('Código ou data de nascimento não conferem')).toBeVisible();
    await pac.getByTestId('pac-nascimento').fill('1990-07-01');
    await pac.getByTestId('pac-conferir').click();
    await pac.getByTestId('pac-email-novo').fill('cinthya.e2e@portal.test');
    await pac.getByTestId('pac-senha-nova').fill('frase-sintetica-longa');
    await pac.getByTestId('pac-confirmacao').fill('frase-sintetica-longa');
    await pac.getByTestId('pac-termo').check();
    await pac.getByTestId('pac-politica').check();
    await pac.getByTestId('pac-dados').click();
    await expect(pac.getByTestId('pac-qr')).toBeVisible();
    await semViolacaoAxe(pac, '/paciente (segundo fator)');
    const chave = /aplicativo:\s*([A-Z2-7]+)/.exec(await pac.locator('form').innerText())?.[1] ?? '';
    expect(chave.length).toBeGreaterThanOrEqual(16);
    await pac.getByTestId('pac-codigo-novo').fill(totp(chave));
    await pac.getByTestId('pac-confirmar').click();
    await expect(pac.getByTestId('portal-ativada')).toBeVisible();
    await expect(pac.getByTestId('portal-ola')).toContainText('Cinthya');
    await semViolacaoAxe(pac, '/paciente (início)');

    // Os resultados liberados; abrir grava a visualização.
    await pac.getByTestId('portal-menu-documentos').click();
    await expect(pac.getByTestId('portal-documentos')).toBeVisible();
    await pac.locator('[data-testid^="portal-abrir-resultado-"]').first().click();
    await expect(pac.getByTestId('portal-resultado')).toBeVisible();
    await semViolacaoAxe(pac, '/paciente/documentos');

    // A sessão do portal não abre as telas internas (a casca interna pede a entrada ou nega).
    await pac.goto('/cadastros/pacientes/1003');
    await expect(pac).toHaveURL(/\/(entrar|sem-permissao)/);
    await expect(pac.getByTestId('tela-ficha-paciente')).toHaveCount(0);

    // O pedido de acesso como mãe do filho menor, com o documento.
    await pac.goto('/paciente/responsaveis');
    await expect(pac.getByTestId('portal-pedir-vinculo')).toBeVisible();
    await pac.getByTestId('pac-prontuario').fill('501005');
    await pac.getByTestId('pac-nascimento-rep').fill('2016-05-10');
    await escolher(pac.getByTestId('pac-tipo'), 'pai-mae');
    await escolher(pac.getByTestId('pac-prova'), 'certidao-nascimento');
    await pac
      .getByTestId('pac-arquivo')
      .setInputFiles({ name: 'certidao.pdf', mimeType: 'application/pdf', buffer: PDF });
    await pac.getByTestId('pac-pedir').click();
    await expect(pac.getByTestId('pac-pedido-enviado')).toBeVisible();
    await expect(pac.getByTestId('portal-meus-vinculos')).toContainText('Em conferência');
    // Pendente: o nome do filho não aparece para quem pediu (o pedido não confirma o cadastro de outra pessoa).
    await expect(pac.getByTestId('portal-meus-vinculos')).not.toContainText('Enzo');
    await semViolacaoAxe(pac, '/paciente/responsaveis');

    // A privacidade confere: o documento, o escopo e a senha.
    await entrar(page, 'SINT.PRIVACIDADE');
    await page.goto('/portais/paciente/responsaveis');
    await expect(page.getByTestId('conf-fila')).toContainText('Enzo');
    // A busca pelo prontuário do representado.
    await page.getByTestId('conf-busca').fill('501005');
    await page.getByTestId('conf-buscar').click();
    await expect(page.getByTestId('conf-fila')).toContainText('Enzo');
    await page.locator('[data-testid^="conf-abrir-"]').first().click();
    await expect(page.getByTestId('conf-detalhe')).toBeVisible();
    await expect(page.getByTestId('conf-prova')).toBeVisible();
    await page.getByTestId('conf-senha').fill(SENHA);
    await page.getByTestId('conf-aprovar').click();
    await expect(page.getByTestId('conf-feito')).toContainText('Liberado');
    await semViolacaoAxe(page, '/portais/paciente/responsaveis');

    // A mãe troca de pessoa para o filho; consente pelo representante; abre um pedido do titular.
    await pac.goto('/paciente/responsaveis');
    await expect(pac.getByTestId('portal-meus-vinculos')).toContainText('Liberado');
    await expect(pac.getByTestId('portal-meus-vinculos')).toContainText('Enzo');
    await escolher(pac.getByTestId('portal-pessoa'), { rotulo: 'Enzo' });
    await expect(pac.getByTestId('portal-vendo')).toContainText('Enzo');
    await pac.getByTestId('pac-consentir-pesquisa').click();
    await expect(pac.getByTestId('pac-consent-pesquisa')).toContainText(
      'Registrado pelo representante legal',
    );
    await pac.getByTestId('portal-menu-privacidade').click();
    await expect(pac.getByTestId('portal-vendo')).toContainText('Enzo');
    await escolher(pac.getByTestId('pac-tipo-pedido'), 'acesso');
    await pac.getByTestId('pac-pedir-titular').click();
    await expect(pac.getByTestId('pac-pedido-registrado')).toContainText('protocolo');
    await expect(pac.getByTestId('portal-pedidos')).toContainText('Em análise');
    await semViolacaoAxe(pac, '/paciente/privacidade (representado)');

    // De volta a si: quem acessou o próprio prontuário mostra a abertura do resultado pelo portal ("Você").
    await escolher(pac.getByTestId('portal-pessoa'), { rotulo: /Cinthya/ });
    await pac.getByTestId('pac-acessos-consultar').click();
    // A leitura da trilha vai ao banco: com a VM carregada passa dos 5 s padrão (visto com carga 22).
    await expect(pac.getByTestId('pac-acessos-tabela')).toContainText('Você', { timeout: 30_000 });
    await expect(pac.getByTestId('pac-acessos-tabela')).toContainText('Acesso pelo portal');

    // A ficha na recepção: conta ativa, segundo fator configurado, e-mail só mascarado.
    await entrar(page, 'SINT.RECEPCAO');
    await page.goto('/cadastros/pacientes/1003');
    await expect(page.getByTestId('conta-portal-situacao')).toContainText('Ativa');
    await expect(page.getByTestId('conta-portal-dados')).toContainText('ci***@po***.test');
    await expect(page.getByTestId('conta-portal-dados')).not.toContainText('cinthya.e2e');

    expect(externas).toEqual([]);
    expect(externasPac).toEqual([]);
    await contexto.close();
  });
});
