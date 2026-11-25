// F3.3 (03-PEP L133): central de regras de aviso clínico pelo caminho da tela. As regras gravam e leem só o banco
// próprio, e o E2E roda com a fonte sintética (sem núcleo, as rotas respondem 503). Por isso as rotas
// /api/pep/avisos-clinicos/regras* são simuladas pelo Playwright com massa SINTÉTICA. O que se prova é a tela: o item
// do menu (PEP › Administração do PEP) leva à central; o evento clínico novo é incluído; a regra só grava com nome,
// evento, mensagem, canal e destinatário (sem canal, o botão trava com o motivo na hora, sem ida à API); a regra vai
// à API com o evento, o setor do evento, os canais e os destinatários; a edição manda a versão e o motivo; a emissão
// do evento mostra quantos foram avisados. O efeito no banco (tipo, regra com versão e destinatários, aviso e
// destinatários do aviso, sem o autor) está no contrato de efeito
// apps/api/src/modulos/pep/avisos-clinicos-regras-propria.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { itemDoMenu, semViolacaoAxe } from './ajuda.js';
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

test.describe('central de regras de aviso clínico (03-PEP L133) @F33 @C2-050', () => {
  test('pelo menu, inclui o evento, grava e edita a regra com validação na hora e emite o evento', async ({
    page,
  }) => {
    const tipos: Record<string, unknown>[] = [
      {
        id: 701,
        versao: 1,
        codigo: 'valor_critico_sint',
        descricao: 'Valor crítico sintético',
        categoria: 'valor_critico',
        prioridade: 'alta',
        enviaEmail: false,
        exigeCiencia: true,
        ativo: true,
      },
    ];
    const regras: Record<string, unknown>[] = [];
    const recentes: Record<string, unknown>[] = [];
    const tiposGravados: Record<string, unknown>[] = [];
    const regrasGravadas: Record<string, unknown>[] = [];
    const emitidos: Record<string, unknown>[] = [];
    const opcoes = {
      setor: [
        { id: 31, nome: 'UTI sintética' },
        { id: 32, nome: 'Clínica médica sintética' },
      ],
      especialidade: [{ id: 41, nome: 'Cardiologia sintética' }],
      categoria_profissional: [{ id: 51, nome: 'Enfermagem sintética' }],
      perfil: [{ id: 61, nome: 'Plantonista sintético' }],
      usuario: [{ id: 71, nome: 'Pessoa sintética' }],
    };

    await page.route('**/api/pep/avisos-clinicos/regras**', (r) => {
      const url = new URL(r.request().url());
      const metodo = r.request().method();
      if (metodo === 'POST' && url.pathname.endsWith('/tipos')) {
        const corpo = r.request().postDataJSON() as Record<string, unknown>;
        tiposGravados.push(corpo);
        tipos.push({ ...corpo, id: 702, versao: 1 });
        return json(r, { id: 702 });
      }
      if (metodo === 'POST' && url.pathname.endsWith('/emitir')) {
        const corpo = r.request().postDataJSON() as Record<string, unknown>;
        emitidos.push(corpo);
        recentes.push({
          id: 9301,
          regra: 9201,
          titulo: 'Valor crítico sintético',
          prioridade: 'alta',
          geradoEm: '2026-11-25T10:00:00Z',
          paciente: null,
          sistema: 2,
          email: 0,
          cientes: 0,
        });
        return json(r, { avisos: [9301], destinatarios: 2 });
      }
      if (metodo === 'POST') {
        const corpo = r.request().postDataJSON() as Record<string, unknown>;
        regrasGravadas.push(corpo);
        const existente = regras.findIndex((x) => x.id === corpo.id);
        const numeroVersao = existente >= 0 ? 2 : 1;
        const gravada = { ...corpo, id: 9201, versao: numeroVersao, numeroVersao };
        if (existente >= 0) regras[existente] = gravada;
        else regras.push(gravada);
        return json(r, { id: 9201, numeroVersao });
      }
      return json(r, { tipos, regras, recentes, opcoes });
    });

    await entrar(page, 'SINT.ADMIN');
    await (await itemDoMenu(page, 'Regras de aviso clínico')).click();
    await expect(page).toHaveURL(/\/pep\/avisos-clinicos\/regras/);
    const tela = page.getByTestId('avisos-regras');
    await expect(tela.getByTestId('avr-sem-regras')).toBeVisible();

    // Evento clínico novo: o código fora do padrão trava a inclusão na hora.
    const novoTipo = tela.getByTestId('avr-tipo-novo');
    await novoTipo.getByTestId('avr-tipo-codigo').fill('Pendência!');
    await novoTipo.getByTestId('avr-tipo-descricao').fill('Pendência de assinatura sintética');
    await expect(novoTipo.getByTestId('avr-tipo-incluir')).toBeDisabled();
    await novoTipo.getByTestId('avr-tipo-codigo').fill('pendencia_sint');
    await escolher(novoTipo.getByTestId('avr-tipo-categoria'), 'pendencia');
    await expect(novoTipo.getByTestId('avr-tipo-incluir')).toBeEnabled();
    await novoTipo.getByTestId('avr-tipo-incluir').click();
    await expect(tela.getByTestId('avr-tipo-pendencia_sint')).toContainText(
      'Pendência de assinatura sintética',
    );
    expect(tiposGravados[0]).toMatchObject({ codigo: 'pendencia_sint', categoria: 'pendencia', ativo: true });

    // Regra: evento, setor do evento, mensagem, destinatários e canais; sem canal, o botão trava com o motivo.
    const form = tela.getByTestId('avr-form');
    await form.getByTestId('avr-nome').fill('Valor crítico na UTI sintética');
    await escolher(form.getByTestId('avr-evento'), 'valor_critico_sint');
    await escolher(form.getByTestId('avr-setor-evento'), '31');
    await form.getByTestId('avr-mensagem').fill('Resultado crítico: confira o paciente.');
    await escolher(form.getByTestId('avr-alvo-tipo'), 'setor');
    await escolher(form.getByTestId('avr-alvo'), '31');
    await form.getByTestId('avr-alvo-incluir').click();
    await escolher(form.getByTestId('avr-alvo-tipo'), 'categoria_profissional');
    await escolher(form.getByTestId('avr-alvo'), '51');
    await form.getByTestId('avr-alvo-incluir').click();
    await expect(form.getByTestId('avr-alvos')).toContainText('UTI sintética');
    await expect(form.getByTestId('avr-alvos')).toContainText('Enfermagem sintética');
    await form.getByTestId('avr-canal-sistema').uncheck();
    await expect(form.getByTestId('avr-gravar')).toBeDisabled();
    await expect(form.getByTestId('avr-problema')).toContainText('Escolha ao menos um canal');
    await form.getByTestId('avr-canal-sistema').check();
    await form.getByTestId('avr-canal-email').check();
    await expect(form.getByTestId('avr-gravar')).toBeEnabled();
    await form.getByTestId('avr-gravar').click();

    await expect(tela.getByTestId('avr-regra-9201')).toContainText('Valor crítico na UTI sintética');
    await expect(tela.getByTestId('avr-regra-9201')).toContainText('Valor crítico sintético');
    expect(regrasGravadas).toHaveLength(1);
    expect(regrasGravadas[0]).toMatchObject({
      nome: 'Valor crítico na UTI sintética',
      tipoAviso: 'valor_critico_sint',
      setorEvento: 31,
      especialidadeEvento: null,
      canais: ['sistema', 'email'],
      alvos: [
        { tipo: 'setor', id: 31 },
        { tipo: 'categoria_profissional', id: 51 },
      ],
      ativo: true,
    });

    // Edição: tira um destinatário, manda a versão e o motivo; a lista mostra a versão nova.
    await tela.getByTestId('avr-editar-9201').click();
    await form.getByTestId('avr-remover-categoria_profissional-51').click();
    await form.getByTestId('avr-motivo').fill('Só a equipe do setor recebe.');
    await form.getByTestId('avr-gravar').click();
    await expect(tela.getByTestId('avr-regra-9201')).toContainText('v2');
    expect(regrasGravadas).toHaveLength(2);
    expect(regrasGravadas[1]).toMatchObject({
      id: 9201,
      versao: 1,
      motivo: 'Só a equipe do setor recebe.',
      alvos: [{ tipo: 'setor', id: 31 }],
    });

    // Teste da regra com um evento simulado: quem as regras avisam (os eventos reais passam sozinhos).
    await expect(tela.getByTestId('avr-emitir-dica')).toContainText('Teste da regra');
    const emitir = tela.getByTestId('avr-emitir-form');
    await escolher(emitir.getByTestId('avr-emitir-evento'), 'valor_critico_sint');
    await escolher(emitir.getByTestId('avr-emitir-setor'), '31');
    await emitir.getByTestId('avr-emitir').click();
    await expect(tela.getByTestId('avr-resultado')).toContainText('1 aviso(s) para 2 destinatário(s).');
    await expect(tela.getByTestId('avr-recente-9301')).toContainText('Valor crítico sintético');
    expect(emitidos[0]).toMatchObject({ tipoAviso: 'valor_critico_sint', setor: 31, especialidade: null });

    await semViolacaoAxe(page, '/pep/avisos-clinicos/regras');
  });
});
