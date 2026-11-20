// Coleta e rastreio da amostra sobre a cópia (ficha do M26, regra 3), em transação desfeita: o exame do laboratório
// lançado no setor (internado), a amostra com o código único e a primeira passagem, a segunda coleta do mesmo exame
// recusada, as passagens com o estado relido (a passagem de outra estação, depois da leitura, é recusada). Só contagens.
import { codigoDaAmostra, codigoValido } from '@sgh/dominio-sadt';
import { ErroOperacao } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AmbienteSadt, ambienteSadt, MassaSadt, PODE_ESCREVER } from './copia.spec-util.js';

const trilha = (id: string) => ({
  rede: '',
  hospital: '',
  usuario: 'SGH.TESTE',
  evento: 'sadt.amostra.coletada',
  recurso: 'sadt.amostra.coletar',
  operacao: 'coleta (teste)',
  tabelaAlvo: 'SGH_SADT_AMOSTRA',
  idAlvo: id,
  chaveNaturalAlvo: null,
  resultado: 'sucesso' as const,
  estacao: 'teste',
  correlacao: `int-m26-coleta-${id}`,
  idPaciente: null,
});

describe.skipIf(!PODE_ESCREVER)('coleta e rastreio na cópia (transação desfeita)', () => {
  let a: AmbienteSadt;
  beforeAll(async () => {
    a = await ambienteSadt();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('amostra com código único, a coleta repetida recusada e as passagens pelo estado relido', async () => {
    await a.nucleo.desfazendoNaCopia(
      { rede: a.nucleo.rede, hospital: a.cod, traceId: 'int-m26-coleta' },
      async (e) => {
        const m = new MassaSadt(a, e);
        const tec = await m.profissional(['2212', '2234', '225335']);
        const ex = await m.lancar('I', tec);
        const at = await m.porta.atendimentoDosExames(m.c, [ex.id]);
        expect(at?.atend).toBe('I');
        const coletar = () =>
          m.porta.gravarSgh(
            m.c,
            (x: { id: number }) => ({ ...trilha(String(x.id)), rede: m.c.rede, hospital: m.c.hospital }),
            (g) =>
              g.registrarColeta({
                codigo: (id) => codigoDaAmostra(a.cod, id),
                paciente: at!.paciente,
                atendimento: at!.atendimento,
                reg: at!.reg,
                atend: at!.atend,
                recipiente: null,
                exames: [{ id: ex.id, chave: `teste-${ex.id}` }],
                pulseiraConferida: true,
                estacao: 'teste',
                usuario: tec.login,
              }),
          );
        const r = await coletar();
        expect(codigoValido(r.codigo)).toBe(true);
        const lida = await m.porta.amostraPorCodigo(m.c, r.codigo);
        expect(lida).toMatchObject({ estado: 'coletada', pulseiraConferida: true });
        expect(lida!.eventos).toHaveLength(1);
        expect((await m.porta.exame(m.c, ex.id))?.amostra?.codigo).toBe(r.codigo);
        await expect(coletar()).rejects.toMatchObject({ problema: { codigo: 'amostra-coletada' } });
        const mudar = (de: 'coletada' | 'recebida', para: 'recebida' | 'emTransporte' | 'emAnalise') =>
          m.porta.gravarSgh(m.c, { ...trilha(String(r.id)), rede: m.c.rede, hospital: m.c.hospital }, (g) =>
            g.mudarEstadoAmostra({
              amostra: r.id,
              de,
              para,
              motivo: null,
              detalhe: null,
              usuario: tec.login,
              estacao: 'teste',
            }),
          );
        await mudar('coletada', 'recebida');
        // A passagem lida antes da outra estação (de "coletada"): recusada pelo estado relido.
        const velha = await mudar('coletada', 'emTransporte').catch((x: unknown) => x);
        expect(velha).toBeInstanceOf(ErroOperacao);
        await mudar('recebida', 'emAnalise');
        const fim = await m.porta.amostraPorId(m.c, r.id);
        expect(fim?.estado).toBe('emAnalise');
        expect(fim?.eventos.map((x) => x.estado)).toEqual(['coletada', 'recebida', 'emAnalise']);
        expect((await m.porta.exame(m.c, ex.id))?.estado).toBe('emAnalise');
      },
    );
  });
});
