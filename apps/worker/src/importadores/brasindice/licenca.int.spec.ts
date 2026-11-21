// Brasíndice só com contrato de dados (ficha do M13, regra 9; DP-36), contra o MariaDB real (cliente f22_o5; massa
// sintética fo513l; nenhuma pessoa real): sem licença vigente em licenca_catalogo, o lote é recusado ("sem-contrato") e
// a carga fica "falhou" sem gravar nada; com a licença vigente, a conferência do contrato passa e a publicação para no
// mapa ao modelo próprio ("catalogo-sem-mapa": a escrita das apresentações e preços do Brasíndice ainda não tem tabela
// própria; pedido no saida/05-13.json).
import { JANELA_PADRAO } from '@sgh/dominio-catalogo';
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cargaAprovada,
  escrever,
  garantirCliente,
  garantirEstabelecimento,
  garantirUsuario,
  inserirSintetico,
  limparCargas,
  SEM_BANCO,
} from '../integracao.spec-util.js';
import { PortaPublicacaoPropria } from '../porta-propria.js';
import { publicarCarga } from '../publicador.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o5';
const H = 'fo513l';

describe.skipIf(SEM_BANCO)('licença do Brasíndice (f22_o5)', () => {
  let nucleo: NucleoProprio;
  let est = 0;
  let aprovador = 0;
  const limpar = () =>
    escrever(nucleo, async (e) => {
      await limparCargas(e, [est]);
      await e.executar('DELETE FROM licenca_catalogo WHERE estabelecimento_id = ?', [est]);
    });
  const nova = () =>
    escrever(nucleo, (e) =>
      cargaAprovada(e, {
        estabelecimento: est,
        aprovador,
        catalogo: 'brasindice',
        edicao: '9999',
        linhas: [
          {
            entidade: 'apresentacao',
            chave: 'codigo=99999998',
            comparacao: 'novo',
            depois: { codigo: '99999998', nome: 'ITEM SINTETICO 05-13', pmc: 1, pfb: 1 },
            lote: 1,
          },
        ],
      }),
    );
  const publicar = async (id: number) => {
    const porta = new PortaPublicacaoPropria(nucleo, CLIENTE, H);
    const c = await porta.carga(id);
    if (!c) throw new Error('carga não gravada');
    return publicarCarga({ porta, janela: JANELA_PADRAO, agoraMinutos: () => 23 * 60, ignorarJanela: false, lotesPorCiclo: 1 }, c);
  };

  beforeAll(async () => {
    garantirCliente();
    nucleo = new NucleoProprio();
    await escrever(nucleo, async (e) => {
      est = await garantirEstabelecimento(e, H);
      aprovador = await garantirUsuario(e, 'f22o513.aprovador');
    });
    await limpar();
  });

  afterAll(async () => {
    await limpar();
    await nucleo.encerrar();
  });

  it('sem licença vigente: recusa "sem-contrato" e nada é gravado', async () => {
    const id = await nova();
    const r = await publicar(id);
    expect(r.situacao).toBe('falhou');
    expect(r.motivo).toContain('sem-contrato');
    const c = await escrever(nucleo, (e) =>
      e.uma<{ situacao: string; lotes_publicados: unknown }>('SELECT situacao, lotes_publicados FROM carga_catalogo WHERE id = ?', [id]),
    );
    expect(c).toMatchObject({ situacao: 'falhou', lotes_publicados: 0 });
  });

  it('licença vencida não vale; vigente passa a conferência do contrato', async () => {
    await escrever(nucleo, async (e) => {
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      try {
        await inserirSintetico(e, 'licenca_catalogo', {
          estabelecimento_id: est,
          catalogo: 'brasindice',
          vigencia_inicio: '2020-01-01',
          vigencia_fim: '2020-12-31',
          comprovante_arquivo_id: 990513,
          criado_em: new Date(),
        });
      } finally {
        await e.executar('SET FOREIGN_KEY_CHECKS = 1');
      }
    });
    expect((await publicar(await nova())).motivo).toContain('sem-contrato');
    await escrever(nucleo, async (e) => {
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      try {
        await inserirSintetico(e, 'licenca_catalogo', {
          estabelecimento_id: est,
          catalogo: 'brasindice',
          vigencia_inicio: '2021-01-01',
          vigencia_fim: null,
          comprovante_arquivo_id: 990513,
          criado_em: new Date(),
        });
      } finally {
        await e.executar('SET FOREIGN_KEY_CHECKS = 1');
      }
    });
    const r = await publicar(await nova());
    expect(r.situacao).toBe('falhou');
    expect(r.motivo).toContain('catalogo-sem-mapa');
  });
});
