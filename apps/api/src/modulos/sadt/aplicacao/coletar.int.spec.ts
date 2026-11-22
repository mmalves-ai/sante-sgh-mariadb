// Coleta e rastreio da amostra na porta própria do SADT, no MariaDB real (cliente f22_o2; massa SINTÉTICA). Contrato de
// efeito: a amostra com código único, o vínculo com os exames, o item pedido em "coletado", o evento com a pulseira
// conferida e a trilha; a coleta repetida recusada; a passagem de estado conferida pelo estado relido (outra estação
// recusada com conflito) e o exame acompanhando a amostra; outro estabelecimento recusado.
import { codigoDaAmostra, codigoValido } from '@sgh/dominio-sadt';
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PortaSadtPropria } from '../porta-propria.js';
import {
  CLIENTE,
  contexto,
  limparMassaSadt,
  linhaTela,
  type MassaSadt,
  montarMassaSadt,
  SEM_BANCO,
} from './copia.spec-util.js';

const codigoDe = (e: unknown) => (e instanceof ErroOperacao ? String(e.problema['codigo'] ?? '') : String(e));

describe.skipIf(SEM_BANCO)('coleta e rastreio da amostra (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaSadtPropria;
  let m: MassaSadt | null = null;
  const um = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-s09col' }, (l) => l.uma(sql, p));

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await montarMassaSadt(nucleo, 'S9C');
    porta = new PortaSadtPropria(nucleo);
  }, 60_000);
  afterAll(async () => {
    await limparMassaSadt(nucleo, m);
    await nucleo.encerrar();
  });

  it('amostra com código único, a coleta repetida recusada e as passagens pelo estado relido', async () => {
    const c = contexto(m!);
    const at = await porta.atendimentoDosExames(c, [m!.itemLab, m!.itemLab2]);
    expect(at).toMatchObject({ paciente: m!.base.paciente, atendimento: m!.base.atendimento, mesmos: true });
    const coletar = (est = m!.base.est) =>
      porta.gravarSgh(
        contexto(m!, est),
        (x: { id: number }) => linhaTela(m!, 'sadt.amostra.coletada', 'amostra_biologica', x.id),
        (g) =>
          g.registrarColeta({
            codigo: (id) => codigoDaAmostra(c.hospital!, id),
            paciente: at!.paciente,
            atendimento: at!.atendimento,
            reg: at!.reg,
            atend: at!.atend,
            recipiente: null,
            exames: [
              { id: m!.itemLab, chave: 'a' },
              { id: m!.itemLab2, chave: 'b' },
            ],
            pulseiraConferida: true,
            estacao: 'teste',
            usuario: m!.base.login,
          }),
      );
    expect(codigoDe(await coletar(m!.base.outroEst).catch((e: unknown) => e))).toBe('exame-inexistente');
    const r = await coletar();
    expect(codigoValido(r.codigo)).toBe(true);
    const lida = await porta.amostraPorCodigo(c, r.codigo);
    expect(lida).toMatchObject({ estado: 'coletada', pulseiraConferida: true });
    expect(lida!.exames.map((x) => x.id).sort()).toEqual([m!.itemLab, m!.itemLab2].sort());
    expect(lida!.eventos).toHaveLength(1);
    expect((await porta.exame(c, m!.itemLab))?.amostra?.codigo).toBe(r.codigo);
    expect((await porta.exame(c, m!.itemLab))?.estado).toBe('coletado');
    expect(await um('SELECT situacao, versao FROM exame_item WHERE id = ?', [m!.itemLab])).toMatchObject({
      situacao: 'coletado',
      versao: 2,
    });
    expect(
      Number(
        (
          await um(
            "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'amostra_biologica' AND entidade_id = ?",
            [r.id],
          )
        )?.['n'],
      ),
    ).toBe(1);
    expect(codigoDe(await coletar().catch((e: unknown) => e))).toBe('amostra-coletada');

    const mudar = (de: 'coletada' | 'recebida', para: 'recebida' | 'emTransporte' | 'emAnalise') =>
      porta.gravarSgh(c, linhaTela(m!, 'sadt.amostra.estado', 'amostra_biologica', r.id), (g) =>
        g.mudarEstadoAmostra({
          amostra: r.id,
          de,
          para,
          motivo: null,
          detalhe: null,
          usuario: m!.base.login,
          estacao: 'teste',
        }),
      );
    await mudar('coletada', 'recebida');
    // A passagem lida antes da outra estação (de "coletada"): recusada pelo estado relido.
    expect(codigoDe(await mudar('coletada', 'emTransporte').catch((e: unknown) => e))).toBe(
      'conflito-versao',
    );
    await mudar('recebida', 'emAnalise');
    const fim = await porta.amostraPorId(c, r.id);
    expect(fim?.estado).toBe('emAnalise');
    expect(fim?.eventos.map((x) => x.estado)).toEqual(['coletada', 'recebida', 'emAnalise']);
    expect((await porta.exame(c, m!.itemLab))?.estado).toBe('emAnalise');
    const { hoje } = await porta.relogio(c);
    const dia = await porta.amostras(c, { data: hoje });
    expect(dia.itens.some((x) => x.id === r.id)).toBe(true);

    // Rejeição: a amostra rejeitada não conta como coletada; o exame volta à coleta (recoleta).
    expect(
      codigoDe(
        await porta
          .gravarSgh(c, linhaTela(m!, 'sadt.amostra.estado', 'amostra_biologica', r.id), (g) =>
            g.mudarEstadoAmostra({
              amostra: r.id,
              de: 'emAnalise',
              para: 'rejeitada',
              motivo: null,
              detalhe: null,
              usuario: m!.base.login,
              estacao: 'teste',
            }),
          )
          .catch((e: unknown) => e),
      ),
    ).toBe('motivo-obrigatorio');
    await porta.gravarSgh(c, linhaTela(m!, 'sadt.amostra.estado', 'amostra_biologica', r.id), (g) =>
      g.mudarEstadoAmostra({
        amostra: r.id,
        de: 'emAnalise',
        para: 'rejeitada',
        motivo: 'hemólise (teste)',
        detalhe: null,
        usuario: m!.base.login,
        estacao: 'teste',
      }),
    );
    expect((await porta.exame(c, m!.itemLab))?.estado).toBe('solicitado');
    expect(await um('SELECT situacao FROM exame_item WHERE id = ?', [m!.itemLab])).toMatchObject({
      situacao: 'solicitado',
    });
    const lista = await porta.coleta(c, { inicio: hoje, fim: hoje });
    const itens = lista.grupos
      .flatMap((g) => g.exames)
      .filter((x) => x.id === m!.itemLab || x.id === m!.itemLab2);
    expect(itens.map((x) => x.coletado)).toEqual([false, false]);
    // A recoleta é aceita: a amostra rejeitada não bloqueia a nova.
    const nova = await coletar();
    expect(nova.id).not.toBe(r.id);
    expect((await porta.exame(c, m!.itemLab))?.amostra?.id).toBe(nova.id);
    expect((await porta.exame(c, m!.itemLab))?.estado).toBe('coletado');
  });
});
