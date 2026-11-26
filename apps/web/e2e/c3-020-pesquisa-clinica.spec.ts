// E2E @C3-020 (F8, 03-PEP L144): pesquisa clínica. Com a API do estudo simulada (page.route, massa sintética, nenhuma
// pessoa real), o médico da equipe de pesquisa (SINT.PESQUISA, perfil `pesquisa-clinica`) abre
// /pep/pesquisa, vê o estudo sintético recrutando, o aviso de triagem automática
// desligada (o botão Triar só libera com paciente indicado pela busca remota), indica o paciente e tria; escolhe o
// candidato, inclui com o TCLE anexado ao prontuário dele e a data da assinatura; registra a visita do participante.
// Confere o corpo de cada POST. Axe sem violação na lista e no estudo aberto.
import { expect, test, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const ESTUDO = {
  id: 9020,
  codigo: 'EST-SINT',
  titulo: 'ESTUDO SINTETICO',
  tituloResumido: null,
  numeroCaae: '12345678.9.0000.0001',
  registroEnsaio: null,
  fase: 'fase_3',
  situacao: 'recrutando',
  aprovacaoEticaEm: '2026-01-10',
  aprovadoComite: true,
  aprovadoDiretoria: false,
  inicio: '2026-01-01',
  fim: null,
  diasProcessamento: null,
  recruta: true,
  versao: 3,
  equipe: [
    {
      id: 1,
      profissional: 77,
      nome: 'PROFISSIONAL SINTETICO',
      papel: 'investigador_principal',
      inicio: '2026-01-01',
      fim: null,
    },
  ],
  criterios: [
    {
      id: 11,
      sequencia: 1,
      tipo: 'inclusao',
      grupo: 1,
      descricao: 'Diagnóstico do estudo',
      fonte: 'diagnostico',
      valorTexto: 'Z99P',
      valorMinimo: null,
      valorMaximo: null,
      ativo: true,
      versao: 1,
    },
  ],
  triagens: [] as unknown[],
  participantes: [] as unknown[],
};
const TRIAGEM = {
  id: 501,
  paciente: 301,
  nome: 'PACIENTE SINTETICO A',
  modo: 'manual',
  processadoEm: '2026-11-26T10:00',
  atendidos: [{ criterio: 11, valor: 'Z99P1' }],
  aConferir: [],
  situacao: 'identificado',
  avaliadoEm: null,
  observacao: null,
  versao: 1,
};
const PARTICIPANTE = {
  id: 601,
  paciente: 301,
  nome: 'PACIENTE SINTETICO A',
  codigo: 'P-001',
  braco: null,
  situacao: 'incluido',
  consentimentoEm: '2026-11-26T09:00',
  incluidoEm: '2026-11-26T10:05',
  inicioTratamento: null,
  fimTratamento: null,
  saidaEm: null,
  motivoSaida: null,
  ultimaVisita: null,
  versao: 1,
};

test.describe('Pesquisa clínica: triagem que só sugere, inclusão com TCLE e visita @C3-020 @fase8', () => {
  test('estudo recrutando, triagem manual, inclusão com o termo e visita; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    const estado = { triado: false, incluido: false };
    const posts: { url: string; corpo: Record<string, unknown> }[] = [];
    const json = (corpo: unknown) => ({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(corpo),
    });
    await page.route('**/api/pep/pesquisa**', async (r) => {
      const req = r.request();
      const caminho = new URL(req.url()).pathname;
      if (req.method() === 'POST') {
        posts.push({ url: caminho, corpo: req.postDataJSON() as Record<string, unknown> });
        if (caminho.endsWith('/triagem')) {
          estado.triado = true;
          return r.fulfill(json({ avaliados: 1, sugeridos: 1 }));
        }
        if (caminho.endsWith('/avaliar')) {
          estado.incluido = true;
          return r.fulfill(json({ participante: PARTICIPANTE.id }));
        }
        return r.fulfill(json({ ok: true }));
      }
      if (caminho === '/api/pep/pesquisa')
        return r.fulfill(
          json({
            triagemAutomatica: false,
            estudos: [
              {
                id: ESTUDO.id,
                codigo: ESTUDO.codigo,
                titulo: ESTUDO.titulo,
                situacao: 'recrutando',
                fase: 'fase_3',
                numeroCaae: ESTUDO.numeroCaae,
                investigador: 'PROFISSIONAL SINTETICO',
                inicio: '2026-01-01',
                fim: null,
                participantes: estado.incluido ? 1 : 0,
                candidatos: estado.triado && !estado.incluido ? 1 : 0,
                versao: 3,
              },
            ],
          }),
        );
      if (caminho.endsWith('/pacientes'))
        return r.fulfill(json([{ id: 301, nome: 'PACIENTE SINTETICO A', prontuario: 9301 }]));
      if (caminho.endsWith('/anexos'))
        return r.fulfill(json([{ id: 801, nome: 'TCLE assinado', em: '2026-11-26T09:10' }]));
      if (caminho.endsWith('/profissionais'))
        return r.fulfill(json([{ id: 77, nome: 'PROFISSIONAL SINTETICO' }]));
      return r.fulfill(
        json({
          ...ESTUDO,
          triagens: estado.triado
            ? [{ ...TRIAGEM, situacao: estado.incluido ? 'incluido' : 'identificado' }]
            : [],
          participantes: estado.incluido ? [PARTICIPANTE] : [],
        }),
      );
    });

    await entrar(page, 'SINT.PESQUISA');
    await page.goto('/pep/pesquisa');
    const tela = page.getByTestId('pesquisa-clinica');
    await expect(tela).toBeVisible();
    await expect(tela).not.toContainText(/SPDATA|legado|sistema atual/i);
    await expect(page.getByTestId('pesquisa-estudos')).toContainText('EST-SINT');
    await semViolacaoAxe(page, 'pesquisa clínica: lista dos estudos');

    await page.getByTestId(`pesquisa-abrir-${ESTUDO.id}`).click();
    const estudo = page.getByTestId('pesquisa-estudo');
    await expect(estudo).toContainText('Recrutando');
    await expect(page.getByTestId('pesquisa-automatica')).toContainText('desligada');
    await expect(page.getByTestId('pesquisa-triar')).toBeDisabled();

    // Indicação manual: a busca remota traz o paciente sintético.
    await page.getByTestId('pesquisa-paciente').click();
    await page.getByRole('searchbox').last().fill('PACIENTE');
    await page.getByRole('option', { name: 'PACIENTE SINTETICO A' }).click();
    await expect(page.getByTestId('pesquisa-indicados')).toContainText('PACIENTE SINTETICO A');
    await page.getByTestId('pesquisa-triar').click();
    await expect(page.getByTestId('pesquisa-aviso')).toContainText('1 sugerido');
    expect(posts.at(-1)).toEqual({
      url: `/api/pep/pesquisa/${ESTUDO.id}/triagem`,
      corpo: { pacientes: [301] },
    });
    await expect(page.getByTestId('pesquisa-candidatos')).toContainText('Identificado');

    // Inclusão com o TCLE anexado ao prontuário do próprio paciente.
    await page.getByTestId('pesquisa-candidato').click();
    await page.getByRole('option', { name: 'PACIENTE SINTETICO A' }).click();
    await page.getByTestId('pesquisa-tcle-em').fill('2026-11-26T09:00');
    await page.getByTestId('pesquisa-tcle').click();
    await page.getByRole('option', { name: /TCLE assinado/ }).click();
    await page.getByTestId('pesquisa-avaliar').click();
    expect(posts.at(-1)).toMatchObject({
      url: `/api/pep/pesquisa/triagens/${TRIAGEM.id}/avaliar`,
      corpo: { versao: 1, decisao: 'incluido', anexo: 801, consentimentoEm: '2026-11-26T09:00' },
    });
    await expect(page.getByTestId('pesquisa-participantes')).toContainText('Incluído');
    await semViolacaoAxe(page, 'pesquisa clínica: estudo aberto');

    // Acompanhamento: visita do participante.
    await page.getByTestId('pesquisa-acompanhamento').getByRole('combobox').first().click();
    await page.getByRole('option', { name: 'PACIENTE SINTETICO A' }).click();
    await page.getByTestId('pesquisa-visita-em').fill('2026-11-27T08:30');
    await page.getByTestId('pesquisa-registrar-visita').click();
    expect(posts.at(-1)).toEqual({
      url: `/api/pep/pesquisa/participantes/${PARTICIPANTE.id}/visita`,
      corpo: { ocorridoEm: '2026-11-27T08:30', observacao: null },
    });
    expect(externas).toEqual([]);
  });
});
