// Ajustes de valor e laudos do bem (W0-08, M1) na porta própria contra o MariaDB real, cliente f22_o2 (onda 2), com
// massa SINTÉTICA (massa.spec-util.ts). O laudo anexado grava em laudo_bem (o mesmo PDF no mesmo bem não duplica) e
// volta nas leituras. O ajuste (revisão de estimativa, recuperabilidade e reavaliação) e o seu estorno ainda pedem
// modelo (pedido ao orquestrador, DDL na saída do lote 02-11): a porta recusa com `modelo-pendente`, sem gravar nada
// (o bem fica na mesma versão e a trilha não ganha linha), e a leitura dos ajustes devolve vazio. A regra do ajuste segue provada pura em @sgh/dominio-patrimonio e na memória (patrimonio-http.spec).
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE_PAT,
  contextoPat,
  encerrarMassaPatrimonio,
  type MassaPatrimonio,
  prepararMassaPatrimonio,
  SEM_BANCO_PAT,
  trilhaPat,
} from './massa.spec-util.js';
import { PortaPatrimonioPropria } from './porta-propria.js';

describe.skipIf(SEM_BANCO_PAT)('ajustes e laudos do bem na porta própria (MariaDB, cliente f22_o2)', () => {
  let m: MassaPatrimonio | null = null;
  let porta: PortaPatrimonioPropria;
  let bem = 0;

  beforeAll(async () => {
    m = await prepararMassaPatrimonio('J');
    porta = new PortaPatrimonioPropria(m.nucleo, CLIENTE_PAT);
    const [b] = await porta.cadastrar(
      contextoPat(m),
      {
        bens: [
          {
            empresa: 1,
            plaqueta: 'L0211-AJ1',
            descricao: 'BEM SINTETICO DO AJUSTE',
            grupo: 'maquinas',
            origem: m.origem,
            documento: 'termo',
            nota: null,
            itemNota: null,
            item: null,
            termo: { numero: 'T-AJ', data: '2025-01-05', doador: '' },
            dataAquisicao: '2025-01-05',
            valorCent: 60_000_00,
            residualCent: 0,
            vidaUtilMeses: 60,
            coeficiente: null,
            inicioDepreciacao: '2025-02',
            depreciavel: true,
            centro: m.centro1,
            localDetalhe: null,
            tipoResponsavel: null,
            responsavel: null,
            marca: null,
            modelo: null,
            numeroSerie: null,
          },
        ],
        item: null,
      },
      'l0211p.patrimonio',
      (n) => `AJ${n}`,
      trilhaPat(m, 'patrimonio.bem.cadastrado', 'bem_patrimonial', null),
    );
    bem = b!.id;
  });
  afterAll(async () => {
    await encerrarMassaPatrimonio(m);
  });

  it('registrar e estornar o ajuste: grava o ajuste com a trilha, sobe a versão do bem e estorna uma vez só', async () => {
    const c = contextoPat(m!);
    const antes = (await porta.bem(c, bem))!;
    const trilha = trilhaPat(m!, 'patrimonio.ajuste.registrado', 'ajuste_valor_bem', bem);
    await expect(
      porta.registrarAjuste(
        contextoPat(m!),
        { bem, versao: antes.versao, motivo: 'x', hoje: '2026-11-21' },
        't',
        () => ({
          impedimento: { codigo: 'sem-conta', detalhe: 'Sem a conta da perda.' },
        }),
        trilha,
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'sem-conta' } });
    let vista: { bem: number; marco: unknown; contas: boolean } | null = null;
    const a = await porta.registrarAjuste(
      contextoPat(m!),
      { bem, versao: antes.versao, motivo: 'Teste de recuperabilidade sintético', hoje: '2026-11-21' },
      't',
      (s) => {
        vista = { bem: s.bem.id, marco: s.marco, contas: s.contasConfiguradas };
        return {
          ajuste: {
            tipo: 'impairment',
            competenciaMarco: '2025-12',
            data: '2025-12-31',
            valorContabilAntesCent: 50_000_00,
            valorContabilDepoisCent: 40_000_00,
            acumuladaMarcoCent: 10_000_00,
            perdaCent: 10_000_00,
            residualCent: 0,
            vidaRestanteMeses: 49,
            valorJustoCent: null,
            laudo: null,
            origem: 'tela',
          },
        };
      },
      trilha,
    );
    expect(vista).toEqual({ bem, marco: null, contas: expect.any(Boolean) });
    expect(a).toMatchObject({
      bem,
      tipo: 'impairment',
      competenciaMarco: '2025-12',
      perdaCent: 10_000_00,
      estorno: null,
    });
    expect(a.registradoEm).not.toBe('');
    const depois = (await porta.bem(c, bem))!;
    expect(depois.versao).toBeGreaterThan(antes.versao);
    await expect(
      porta.registrarAjuste(
        contextoPat(m!),
        { bem, versao: antes.versao, motivo: 'x', hoje: '2026-11-21' },
        't',
        () => {
          throw new Error('não deveria planejar');
        },
        trilha,
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'desatualizado' } });
    expect((await porta.ajustes(c, bem)).map((x) => x.id)).toEqual([a.id]);
    // O marco vale para a depreciação das competências seguintes, não para a própria.
    const marco = (await porta.bensParaDepreciar(c, 1, '2026-01')).bens.find((b) => b.id === bem)?.marco;
    expect(marco).toMatchObject({
      ajuste: a.id,
      competencia: '2025-12',
      baseCent: 40_000_00,
      vidaRestanteMeses: 49,
    });
    expect((await porta.bensParaDepreciar(c, 1, '2025-12')).bens.find((b) => b.id === bem)?.marco).toBeNull();

    const e = await porta.estornarAjuste(
      contextoPat(m!),
      { ajuste: a.id, motivo: 'Registrado por engano', origem: 'tela', hoje: '2026-11-21' },
      't',
      (s) =>
        s.ultimoComMarco?.id === a.id && s.cotasPosteriores.length === 0
          ? null
          : { codigo: 'x', detalhe: 'x' },
      trilha,
    );
    expect(e.estorno).toMatchObject({ data: '2026-11-21', motivo: 'Registrado por engano', origem: 'tela' });
    await expect(
      porta.estornarAjuste(
        contextoPat(m!),
        { ajuste: a.id, motivo: 'de novo', origem: 'tela', hoje: '2026-11-21' },
        't',
        () => null,
        trilha,
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'ja-estornado' } });
    expect((await porta.bensParaDepreciar(c, 1, '2026-01')).bens.find((b) => b.id === bem)?.marco).toBeNull();
  });

  it('laudo: anexa ao bem, o mesmo PDF não duplica e as leituras devolvem o laudo', async () => {
    const c = contextoPat(m!);
    const sha256 = 'ab'.repeat(32);
    const dados = {
      bem,
      nome: 'laudo-sintetico.pdf',
      descricao: 'Laudo de teste',
      chave: `teste/${sha256}`,
      sha256,
      tamanho: 1234,
    };
    const trilha = trilhaPat(m!, 'patrimonio.laudo.anexado', 'laudo_bem', bem);
    const l = await porta.anexarLaudo(c, dados, 'teste', trilha);
    expect(l).toMatchObject({
      bem,
      nome: 'laudo-sintetico.pdf',
      descricao: 'Laudo de teste',
      sha256,
      tamanho: 1234,
    });
    expect(l.enviadoEm).not.toBe('');
    expect((await porta.anexarLaudo(c, dados, 'teste', trilha)).id).toBe(l.id);
    expect(await porta.laudos(c, bem)).toEqual([l]);
    expect(await porta.laudo(c, l.id)).toEqual(l);
    expect(await porta.laudo(c, l.id + 1_000_000)).toBeNull();
    // ADR 0004 (RDC 509): o PDF fica registrado em `arquivo` com hash, tamanho, tipo, imutável e guarda de 5 anos.
    const registro = await m!.nucleo.lerSomente({ cliente: CLIENTE_PAT, correlacao: 'laudo-arquivo' }, (x) =>
      x.uma(
        'SELECT hash_sha256, tamanho_bytes, tipo_mime, imutavel, retencao_ate, finalidade FROM arquivo WHERE chave_armazenamento = ?',
        [dados.chave],
      ),
    );
    expect(registro).toMatchObject({
      hash_sha256: sha256,
      finalidade: 'laudo',
      tipo_mime: 'application/pdf',
    });
    expect(Number(registro?.['tamanho_bytes'])).toBe(1234);
    expect(Number(registro?.['imutavel'])).toBe(1);
    const ate = registro?.['retencao_ate'];
    const ateIso = ate instanceof Date ? ate.toISOString().slice(0, 10) : String(ate);
    expect(ateIso >= `${new Date().getUTCFullYear() + 5}-01-01`).toBe(true);
  });
});
