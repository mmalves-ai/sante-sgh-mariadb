// W0-10 (M2) na cópia, em transação SEMPRE desfeita: a cópia do prontuário pelo serviço do portal sobre a porta do
// legado. O balcão abre o pedido do titular (SGH_AUD_PEDIDO_TITULAR pelo escritor do M10 e o ato da solicitação na
// mesma transação), confere a legitimidade, gera o PDF (hash e chave no ato; trilha com o hash) e entrega no balcão
// com quem recebeu (pedido atendido). Um paciente qualquer da cópia só é lido pelo ID (nada dele é impresso nem vai
// à trilha); só tabelas SGH_ são escritas.
import { escritasDaTransacao } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AmbienteM27, ambienteM27, PODE_ESCREVER } from '../../acesso/aplicacao/copia.spec-util.js';
import { portaPortalNaTransacao } from '../porta-legado.js';
import { quem } from './copia.spec-util.js';
import { ArmazemProvasMemoria } from './provas.js';
import { ServicoPortalPaciente } from './servico.js';

describe.skipIf(!PODE_ESCREVER)(
  'cópia do prontuário pelo serviço do portal na cópia (transação desfeita)',
  () => {
    let a: AmbienteM27;
    beforeAll(async () => {
      a = await ambienteM27();
    }, 900_000);
    afterAll(async () => {
      await a?.nucleo.encerrar();
    });

    it('balcão: pedido do titular → legitimidade → geração com hash → entrega; trilha sem dado clínico; só SGH_', async () => {
      const relogio = { agora: new Date() };
      const q = quem(a.c.rede, a.cod, 'SGH.TESTE.W010');
      const r = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-w010-copia' }, async (e) => {
        const [x] = await e.consultar(
          'SELECT FIRST 1 ID, PRONT FROM RICADPAC WHERE PRONT > 0 ORDER BY ID DESC',
          [],
          {
            teto: 1,
          },
        );
        const paciente = Number(x?.['ID']);
        const base = portaPortalNaTransacao(e);
        const s = new ServicoPortalPaciente(
          {
            ...base,
            paciente: async (_c, id) =>
              id === paciente
                ? {
                    id,
                    prontuario: Number(x?.['PRONT']),
                    nascimento: '1970-01-01',
                    ativo: true,
                    obito: false,
                    unificadoEm: null,
                    primeiroNome: 'Titular',
                    capacidadeCivil: null,
                    temGuardiao: false,
                  }
                : null,
          },
          null,
          null,
          new ArmazemProvasMemoria(),
          {
            rede: a.c.rede,
            produto: 'Produto de teste',
            chaveMestra: Buffer.alloc(32, 5),
            estabelecimentoPadrao: null,
          },
          null,
          () => relogio.agora,
        );
        s.prontuarioCopia = async () => [
          { titulo: 'Registros do prontuário', linhas: ['registro sintético'] },
        ];
        const { protocolo } = await s.pedirCopiaNoBalcao(q, {
          paciente,
          solicitante: 'titular',
          vinculo: null,
          prova: null,
          observacao: null,
        });
        expect((await s.filaCopias(q, { pendentes: true, paciente }))[0]).toMatchObject({
          protocolo,
          canal: 'balcao',
          situacao: 'aberto',
          etapa: 'aguardando-conferencia',
        });
        await expect(s.gerarCopia(q, { protocolo })).rejects.toMatchObject({ status: 409 });
        await s.conferirLegitimidadeCopia(q, {
          protocolo,
          solicitante: 'titular',
          vinculo: null,
          prova: null,
        });
        const g = await s.gerarCopia(q, { protocolo });
        expect(Buffer.from(g.pdf).subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');
        await expect(
          s.entregarCopia(q, { protocolo, meio: 'balcao', recebedor: null }),
        ).rejects.toMatchObject({
          status: 409,
        });
        await s.entregarCopia(q, { protocolo, meio: 'balcao', recebedor: 'o próprio titular' });
        const atos = await s.atosDaCopia(q, protocolo);
        expect(atos.map((t) => t.ato)).toEqual(['solicitacao', 'legitimidade', 'geracao', 'entrega']);
        expect(atos[2]).toMatchObject({ hash: g.hash, paginas: g.paginas });
        expect(await s.filaCopias(q, { pendentes: true, paciente })).toEqual([]);
        const trilha = await e.consultar(
          `SELECT EVENTO, CHAVE_NATURAL_ALVO FROM SGH_TRILHA WHERE CORRELACAO = ? AND HOSPITAL = ? ORDER BY ID`,
          [q.correlacao, a.cod],
          { teto: 20 },
        );
        const linhas = trilha.map(
          (t) => `${String(t['EVENTO']).trim()} ${String(t['CHAVE_NATURAL_ALVO'] ?? '').trim()}`,
        );
        expect(linhas).toEqual(
          expect.arrayContaining([
            `portal.copiaProntuario.ato ${protocolo}:copia:solicitacao`,
            `portal.copiaProntuario.ato ${protocolo}:copia:legitimidade`,
            `portal.copiaProntuario.ato ${protocolo}:copia:geracao:${g.hash}`,
            `portal.copiaProntuario.ato ${protocolo}:copia:entrega:balcao`,
          ]),
        );
        expect(linhas.join()).not.toMatch(/registro sintético|próprio titular/);
        return (await escritasDaTransacao(e)).map((w) => w.tabela);
      });
      for (const t of r) expect(t).toMatch(/^SGH_/);
      expect(r).toEqual(
        expect.arrayContaining(['SGH_AUD_PEDIDO_TITULAR', 'SGH_AUD_COPIA_ATO', 'SGH_TRILHA']),
      );
    }, 300_000);
  },
);
