// Regra 11 (M34) na cópia, em transação DESFEITA: o fato gravado pelo outro sistema (o resultado liberado do exame)
// chega à integração nova por leitura incremental — a marca d'água recuada para antes da última liberação da cópia —
// com a chave anti-duplicação (o segundo ciclo relê pela sobreposição e não cria evento); nenhum trigger novo (o
// schema da cópia é o homologado); o consumidor idempotente cria UMA mensagem por evento para o parceiro ativo que
// assina. Mede o tempo da leitura do lote. Só contagens no log.
import { resolve } from 'node:path';
import {
  ambienteEfetivo,
  caminhoArquivoAmbiente,
  criarParceiro,
  type Escritor,
  gravarMarcaFato,
  lerCodigos,
  lerConfiguracaoNucleo,
  NucleoLegado,
  alterarParceiro,
  travaDaCopiaSegura,
} from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AcessoIntegracao } from './acesso.js';
import { distribuirEvento } from './consumidor-idempotente.js';
import { cicloVigiaFatos, FATOS_VIGIADOS } from './vigia-fatos.js';

const raiz = resolve(import.meta.dirname, '../../../..');
const { env } = ambienteEfetivo(caminhoArquivoAmbiente(process.env, raiz));
const codigos = lerCodigos(env);
const PODE = codigos.length > 0 && travaDaCopiaSegura(process.pid);
let nucleo: NucleoLegado;
const cod = codigos[0] as string;

beforeAll(async () => {
  if (!PODE) return;
  nucleo = new NucleoLegado({
    env: { ...env, FB_POOL_TETO: '3' },
    driver: criarDriverNativo({ biblioteca: lerConfiguracaoNucleo(env).bibliotecaCliente }),
    pastaHomologada: resolve(raiz, 'tools/schema-check/homologado'),
  });
  await nucleo.verificarSchema(cod);
});
afterAll(async () => {
  if (PODE) await nucleo.encerrar();
});

/** O acesso sobre a transação aberta (leituras e gravações enxergam o que a transação gravou). */
const naTransacao = (e: Escritor): AcessoIntegracao => ({
  ler: (_h, fn) => fn(e),
  gravar: (_h, fn) => fn(e),
});

describe.skipIf(!PODE)('vigia dos fatos na cópia (regra 11)', () => {
  it('lê o resultado liberado depois da marca, sem duplicar na releitura, e o consumidor distribui uma vez', async () => {
    const ctx = { rede: nucleo.rede, hospital: cod, traceId: 'int-m34-vigia' };
    await nucleo.desfazendoNaCopia(ctx, async (e) => {
      const [m] = await e.consultar(
        `SELECT MAX(s.DATA_HORA_ULTIMA_ATUALIZACAO) C FROM SILANEXA s
          WHERE s.DATA >= DATEADD(-180 DAY TO CURRENT_DATE) AND s.RESLIB = 'T'`,
        [],
        { teto: 1, tempoMaximoMs: 120_000 },
      );
      const ultima = m?.['C'] instanceof Date ? m['C'] : null;
      expect(ultima).not.toBeNull();
      await criarParceiro(
        e,
        cod,
        {
          codigo: 'int-vigia-m34',
          nome: 'Parceiro do teste da vigia',
          tipo: 'api',
          canal: null,
          escopos: ['resultado.ler'],
          eventos: ['fato.resultado.liberado'],
          limiteTentativas: 3,
          finalidade: 'Teste de integração da leitura incremental.',
          baseLegal: 'tutela-da-saude',
        },
        'SGH.TESTE',
      );
      await alterarParceiro(
        e,
        cod,
        'int-vigia-m34',
        {
          nome: 'Parceiro do teste da vigia',
          canal: null,
          escopos: ['resultado.ler'],
          eventos: ['fato.resultado.liberado'],
          limiteTentativas: 3,
          finalidade: 'Teste de integração da leitura incremental.',
          baseLegal: 'tutela-da-saude',
          ativo: true,
        },
        'SGH.TESTE',
      );
      // A marca uma hora antes da última liberação (o lote pequeno: até 50).
      await gravarMarcaFato(e, cod, 'resultado.liberado', {
        ultimoId: '0',
        ultimoCarimbo: new Date(ultima!.getTime() - 3_600_000),
        lidos: 0,
      });
      const acesso = naTransacao(e);
      const t0 = performance.now();
      const r1 = await cicloVigiaFatos(acesso, nucleo.rede, cod, 50, [FATOS_VIGIADOS[0]!]);
      const ms = Math.round(performance.now() - t0);
      console.log('vigia dos fatos: 1º ciclo', JSON.stringify(r1), `${ms} ms`);
      expect(r1[0]!.lidos).toBeGreaterThan(0);
      expect(r1[0]!.eventos).toBeGreaterThan(0);
      const r2 = await cicloVigiaFatos(acesso, nucleo.rede, cod, 50, [FATOS_VIGIADOS[0]!]);
      console.log('vigia dos fatos: 2º ciclo', JSON.stringify(r2));
      // A releitura recua a sobreposição: as já vistas não viram evento de novo.
      expect(r2[0]!.repetidos).toBeGreaterThan(0);
      const eventos = await e.consultar(
        `SELECT CHAVE_EVENTO, TIPO, CARGA FROM SGH_OUTBOX WHERE HOSPITAL = ? AND TIPO = 'fato.resultado.liberado'
          ORDER BY ID DESC`,
        [cod],
        { teto: 200 },
      );
      expect(eventos.length).toBe(r1[0]!.eventos + r2[0]!.eventos);
      // A carga leva só IDs (nenhum nome).
      for (const x of eventos)
        expect(String(x['CARGA'])).toMatch(/^\{"exame":\d+,"paciente":\d+,"atendimento":\d+,"ato":\d+\}$/);
      // O consumidor: uma mensagem por evento para o parceiro ativo; a repetição não duplica.
      const ev = {
        chave: String(eventos[0]!['CHAVE_EVENTO']).trim(),
        tipo: 'fato.resultado.liberado',
        dados: { ...JSON.parse(String(eventos[0]!['CARGA'])), hospital: cod },
      };
      expect(await distribuirEvento(acesso, ev)).toMatchObject({ parceiros: 1, incluidas: 1 });
      expect(await distribuirEvento(acesso, ev)).toMatchObject({ parceiros: 1, incluidas: 0, repetidas: 1 });
      // Nenhum trigger novo: o schema da cópia segue o homologado (nenhum gatilho SGH_ nas tabelas do outro sistema).
      const [g] = await e.consultar(
        "SELECT COUNT(*) N FROM RDB$TRIGGERS WHERE RDB$TRIGGER_NAME STARTING WITH 'SGH_' AND RDB$SYSTEM_FLAG = 0",
        [],
        { teto: 1 },
      );
      expect(Number(g?.['N'])).toBe(0);
    });
  });
});
