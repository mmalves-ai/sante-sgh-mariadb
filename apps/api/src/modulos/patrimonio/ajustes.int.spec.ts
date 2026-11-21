// Ajustes de valor e laudos do bem (W0-08, M1) na porta própria contra o MariaDB real, cliente f22_o2 (onda 2), com
// massa SINTÉTICA (massa.spec-util.ts). O ajuste (revisão de estimativa, recuperabilidade e reavaliação), o seu
// estorno e o laudo anexado ainda pedem modelo (pedido ao orquestrador, DDL na saída do lote 02-11): a porta recusa
// com `modelo-pendente`, sem gravar nada (o bem fica na mesma versão e a trilha não ganha linha), e as leituras
// devolvem vazio. A regra do ajuste segue provada pura em @sgh/dominio-patrimonio e na memória (patrimonio-http.spec).
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

  const contarTrilha = async () =>
    Number(
      (
        await m!.nucleo.lerSomente({ cliente: CLIENTE_PAT, correlacao: 'int-0211-aj' }, (l) =>
          l.uma<{ n: number }>("SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'bem_patrimonial' AND entidade_id = ?", [bem]),
        )
      )?.n,
    );

  it('registrar, estornar e anexar laudo: recusados com modelo-pendente, sem gravar', async () => {
    const antes = (await porta.bem(contextoPat(m!), bem))!;
    const trilhaAntes = await contarTrilha();
    for (const p of [porta.registrarAjuste(), porta.estornarAjuste(), porta.anexarLaudo()])
      await expect(p).rejects.toMatchObject({ problema: { status: 409, codigo: 'modelo-pendente' } });
    expect((await porta.bem(contextoPat(m!), bem))?.versao).toBe(antes.versao);
    expect(await contarTrilha()).toBe(trilhaAntes);
  });

  it('leituras do ajuste e do laudo: vazias', async () => {
    expect(await porta.ajustes()).toEqual([]);
    expect(await porta.laudos()).toEqual([]);
    expect(await porta.laudo()).toBeNull();
  });
});
