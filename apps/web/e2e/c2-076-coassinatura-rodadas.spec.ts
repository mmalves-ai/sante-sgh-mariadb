// E2E @C2-076 (F3.3, 03-PEP linha 96): coassinatura do preceptor com rodadas. As decisões e a nova rodada gravam só
// no banco do cliente (na fonte sintética as portas em memória não têm a nova rodada), então este E2E simula as rotas
// `/api/pep/assinaturas`, `/api/pep/supervisao/*` com um estado em memória que segue a regra do servidor
// (decidirCoassinatura e novaRodadaDeCoassinatura do domínio). O que fica no banco (a assinatura do preceptor no
// documento do prontuário, o pedido de ajuste com o motivo, a rodada seguinte pendente e o histórico das anteriores)
// está no contrato de efeito apps/api/src/modulos/pep/documentos-propria-pareceres.int.spec.ts. Aqui se prova o fluxo:
// o preceptor pede ajuste (botão só com o motivo de 10 caracteres, validação na hora), o autor vê o registro devolvido
// com o motivo e pede de novo ao mesmo preceptor num clique, e o preceptor coassina a rodada nova. Axe na tela. Massa
// SINTÉTICA.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';

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

const REGISTRO = 7601;
const PACIENTE = 1001;
const PRECEPTOR = 4101;

function simular(page: Page) {
  const corpos: { url: string; corpo: Record<string, unknown> }[] = [];
  // Rodadas do registro: a 1ª nasce pendente com o registro do residente.
  const rodadas: { id: number; sequencia: number; situacao: string; motivo: string | null }[] = [
    { id: 900, sequencia: 1, situacao: 'pendente', motivo: null },
  ];
  const pendente = () => rodadas.find((r) => r.situacao === 'pendente');
  const ultima = () => rodadas[rodadas.length - 1]!;
  return {
    corpos,
    rodadas,
    async ligar() {
      await page.route('**/api/pep/assinaturas', (rota) => {
        const p = pendente();
        return json(rota, {
          itens: [],
          total: 0,
          assinar: { pode: true, motivo: null },
          categoria: null,
          coassinaturas: p
            ? [
                {
                  id: p.id,
                  registro: REGISTRO,
                  paciente: PACIENTE,
                  nome: 'PACIENTE FICTICIO C2-076',
                  residente: 'SINT.RESIDENTE',
                  em: '2025-05-10T08:00:00-03:00',
                },
              ]
            : [],
        });
      });
      await page.route('**/api/pep/supervisao/devolvidos', (rota) => {
        const u = ultima();
        const devolvido = u.situacao === 'ajuste_solicitado' || u.situacao === 'recusado';
        return json(rota, {
          itens: devolvido
            ? [
                {
                  supervisao: u.id,
                  registro: REGISTRO,
                  sequencia: u.sequencia,
                  decisao: u.situacao,
                  motivo: u.motivo,
                  decididoEm: '2025-05-10T09:00:00-03:00',
                  preceptor: PRECEPTOR,
                  paciente: PACIENTE,
                  atendimento: 5001,
                },
              ]
            : [],
        });
      });
      await page.route(/\/api\/pep\/supervisao\/\d+\/coassinar$/, (rota) => {
        const c = rota.request().postDataJSON() as Record<string, unknown>;
        corpos.push({ url: rota.request().url(), corpo: c });
        const id = Number(/supervisao\/(\d+)\//.exec(rota.request().url())?.[1]);
        const r = rodadas.find((x) => x.id === id);
        if (!r || r.situacao !== 'pendente') return json(rota, { codigo: 'coassinatura-encerrada' }, 409);
        const motivo = typeof c['motivo'] === 'string' ? c['motivo'].trim() : null;
        if (c['decisao'] !== 'coassinado' && (!motivo || motivo.length < 10))
          return json(rota, { codigo: 'motivo-obrigatorio' }, 422);
        r.situacao = String(c['decisao']);
        r.motivo = c['decisao'] === 'coassinado' ? null : motivo;
        return json(rota, { ok: true });
      });
      await page.route(/\/api\/pep\/supervisao\/registro\/\d+\/nova-rodada$/, (rota) => {
        const c = rota.request().postDataJSON() as Record<string, unknown>;
        corpos.push({ url: rota.request().url(), corpo: c });
        if (pendente()) return json(rota, { codigo: 'rodada-pendente' }, 409);
        const sequencia = ultima().sequencia + 1;
        rodadas.push({ id: 900 + sequencia, sequencia, situacao: 'pendente', motivo: null });
        return json(rota, { supervisao: 900 + sequencia, sequencia }, 201);
      });
    },
  };
}

test.describe('@C2-076 coassinatura com rodadas', () => {
  test('preceptor pede ajuste, o autor pede de novo ao mesmo preceptor e a rodada nova é coassinada; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const sim = simular(page);
    await sim.ligar();
    await entrar(page, 'SINT.MEDICO');

    // Preceptor: o pedido de ajuste só libera com o motivo (validação na hora, sem ida ao servidor).
    await page.goto('/inicio/assinaturas');
    await expect(page.getByTestId('coassinatura-900')).toBeVisible();
    await expect(page.getByTestId('ajuste-900')).toBeDisabled();
    await page.getByTestId('coassinatura-900').getByRole('textbox').fill('curto');
    await expect(page.getByTestId('ajuste-900')).toBeDisabled();
    await page.getByTestId('coassinatura-900').getByRole('textbox').fill('Descrever a ausculta pulmonar');
    await expect(page.getByTestId('ajuste-900')).toBeEnabled();
    await semViolacaoAxe(page, 'coassinaturas do preceptor');
    await page.getByTestId('ajuste-900').click();
    await expect(page.getByTestId('coassinatura-feita')).toBeVisible();
    expect(sim.corpos.at(-1)?.corpo).toEqual({
      decisao: 'ajuste_solicitado',
      motivo: 'Descrever a ausculta pulmonar',
    });
    await expect(page.getByTestId('lista-coassinaturas')).toHaveCount(0);

    // Autor: o registro devolvido aparece com o motivo; a nova rodada vai ao mesmo preceptor num clique.
    await expect(page.getByTestId(`devolvido-${REGISTRO}`)).toContainText('Descrever a ausculta pulmonar');
    await semViolacaoAxe(page, 'registros devolvidos');
    await page.getByTestId(`nova-rodada-${REGISTRO}`).click();
    await expect(page.getByTestId('nova-rodada-feita')).toBeVisible();
    expect(sim.corpos.at(-1)).toEqual({
      url: expect.stringContaining(`/api/pep/supervisao/registro/${REGISTRO}/nova-rodada`),
      corpo: { preceptor: PRECEPTOR },
    });
    await expect(page.getByTestId('lista-devolvidos')).toHaveCount(0);

    // Preceptor: a rodada nova (sequência 2) chega pendente e é coassinada; as anteriores ficam como histórico.
    await expect(page.getByTestId('coassinatura-902')).toBeVisible();
    await page.getByTestId('coassinar-902').click();
    await expect(page.getByTestId('coassinatura-feita')).toBeVisible();
    expect(sim.rodadas.map((r) => [r.sequencia, r.situacao])).toEqual([
      [1, 'ajuste_solicitado'],
      [2, 'coassinado'],
    ]);
    expect(externas).toEqual([]);
  });
});
