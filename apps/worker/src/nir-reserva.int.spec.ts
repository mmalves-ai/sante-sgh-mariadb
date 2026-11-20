// M44 (etapa 2), regra 11, sobre a cópia (ficha, seção 10: `worker` de expiração com relógio injetado): a leitura do
// ciclo (as reservas vigentes vencidas, transação curta READ ONLY) com o tempo medido; numa transação desfeita, a
// reserva criada com a validade curta expira só depois da validade no relógio injetado, a solicitação volta à análise e
// a segunda expiração não altera nada (o segundo consumidor depois do primeiro). Depois do ROLLBACK, nada fica. A
// disputa entre duas transações sobre a MESMA linha exige a reserva confirmada na cópia (COMMIT proibido): coberta pela
// trava sem espera na unidade e registrada para a homologação. A solicitação a caminho (em trânsito) com a reserva
// vencida também volta à análise pela expiração do `worker` (regra 11), na mesma transação desfeita. Só contagens.
import { resolve } from 'node:path';
import {
  ambienteEfetivo,
  caminhoArquivoAmbiente,
  encerrarReservaSgh,
  lerCodigos,
  lerConfiguracaoNucleo,
  NucleoLegado,
  registrarReservaSgh,
  type ReservaNirLida,
  reservasVencidasNir,
  solicitacaoNir,
  solicitarLeitoSgh,
  somenteSgh,
  transicionarSolicitacaoSgh,
  travaDaCopiaSegura,
} from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expirarReserva, type NucleoNir, reservasAExpirar } from './nir-reserva.service.js';

const raiz = resolve(import.meta.dirname, '../../..');
const { env } = ambienteEfetivo(caminhoArquivoAmbiente(process.env, raiz));
const codigos = lerCodigos(env);
const PODE_ESCREVER = codigos.length > 0 && travaDaCopiaSegura(process.pid);

describe.skipIf(!PODE_ESCREVER)('expiração das reservas na cópia (transações desfeitas)', () => {
  let nucleo: NucleoLegado;
  const cod = codigos[0] as string;
  beforeAll(async () => {
    nucleo = new NucleoLegado({
      env: { ...env, FB_POOL_TETO: '4', FB_LOCK_TIMEOUT_S: '2' },
      driver: criarDriverNativo({ biblioteca: lerConfiguracaoNucleo(env).bibliotecaCliente }),
      pastaHomologada: resolve(raiz, 'tools/schema-check/homologado'),
    });
    await nucleo.verificarSchema(cod);
  });
  afterAll(async () => {
    await nucleo?.encerrar();
  });

  it('a leitura do ciclo com o relógio injetado responde dentro da meta', async () => {
    const t0 = performance.now();
    const r = await reservasAExpirar(nucleo, cod, '2026-10-24T12:00:00');
    const ms = Math.round(performance.now() - t0);
    console.log(`[${cod}] expiração: vencidas ${r.vencidas.length < 5 ? '<5' : r.vencidas.length}; ${ms} ms`);
    expect(r.agora).toBe('2026-10-24T12:00:00');
    expect(ms).toBeLessThan(5_000);
  });

  it('expira só depois da validade, volta à análise e não expira duas vezes; nada fica depois do ROLLBACK', async () => {
    const ctx = { rede: nucleo.rede, hospital: cod, traceId: 'int-m44-nir-expira' };
    const r = await nucleo.desfazendoNaCopia(ctx, async (e0) => {
      const e = somenteSgh(e0);
      const solicitacao = await solicitarLeitoSgh(e, {
        hospital: cod,
        origem: 'eletiva',
        paciente: 990_000_044,
        atendimento: null,
        cabecalho: null,
        internacao: null,
        cirurgia: null,
        prioridade: 'eletivo',
        prazoMin: 2880,
        perfil: { intensiva: false, precaucao: null, tiposAcomodacao: [] },
        clinica: 'M',
        especialidade: null,
        cid: null,
        justificativa: 'Indicacao SINTETICA M44 da integracao do worker',
        situacaoLegado: 7,
        vinculo: 1,
        usuario: 'SGH.TESTE.NIR',
      });
      const reserva = await registrarReservaSgh(e, {
        hospital: cod,
        solicitacao,
        leito: { bloco: 'ZZ', acomodacao: 'M44', leito: '9' },
        validadeMin: 15,
        excecao: null,
        usuario: 'SGH.TESTE.NIR',
      });
      await transicionarSolicitacaoSgh(e, {
        hospital: cod,
        solicitacao,
        acao: 'reservar',
        de: 'solicitado',
        para: 'reservado',
        reserva,
        usuario: 'SGH.TESTE.NIR',
      });
      const longe = '2099-01-01T00:00:00';
      const vencidaAgora = (await reservasVencidasNir(e, cod, '2000-01-01T00:00:00')).some(
        (x) => x.id === reserva,
      );
      const vencidaDepois = (await reservasVencidasNir(e, cod, longe)).some((x) => x.id === reserva);
      const pedido = {
        hospital: cod,
        reserva,
        situacao: 'expirada' as const,
        motivo: 'Validade vencida',
        usuario: 'SGH.NIR',
      };
      const antesDaValidade = await encerrarReservaSgh(e, { ...pedido, vencidaEm: '2000-01-01T00:00:00' });
      const primeiro = await encerrarReservaSgh(e, { ...pedido, vencidaEm: longe });
      await transicionarSolicitacaoSgh(e, {
        hospital: cod,
        solicitacao,
        acao: 'liberarReserva',
        de: 'reservado',
        para: 'em_analise',
        reserva,
        usuario: 'SGH.NIR',
      });
      const segundo = await encerrarReservaSgh(e, { ...pedido, vencidaEm: longe });
      const s = await solicitacaoNir(e, cod, solicitacao);
      return {
        vencidaAgora,
        vencidaDepois,
        antesDaValidade,
        primeiro,
        segundo,
        estado: s?.estado,
        solicitacao,
      };
    });
    console.log(`[${cod}] expiração na transação: ${JSON.stringify({ ...r, solicitacao: undefined })}`);
    expect(r).toMatchObject({
      vencidaAgora: false,
      vencidaDepois: true,
      antesDaValidade: 0,
      primeiro: 1,
      segundo: 0,
      estado: 'em_analise',
    });
    expect(await nucleo.lerSomente(ctx, (l) => solicitacaoNir(l, cod, r.solicitacao))).toBeNull();
  });

  it('a reserva vencida da solicitação em trânsito expira pelo worker e a solicitação volta à análise (ROLLBACK)', async () => {
    const ctx = { rede: nucleo.rede, hospital: cod, traceId: 'int-m44-nir-transito' };
    let solicitacao = 0;
    let estado: string | undefined;
    // A reserva lida só existe na transação desfeita: preenchida pela preparação antes da gravação do worker usá-la.
    const lida = {} as ReservaNirLida;
    // A gravação do worker roda dentro da transação desfeita, depois da preparação sintética na mesma transação.
    const desfazendo: NucleoNir = {
      rede: nucleo.rede,
      lerSomente: nucleo.lerSomente.bind(nucleo),
      encerrar: async () => undefined,
      gravarSgh: ((c: typeof ctx, fn: (e: unknown) => Promise<unknown>) =>
        nucleo.desfazendoNaCopia(c, async (e0) => {
          const e = somenteSgh(e0);
          solicitacao = await solicitarLeitoSgh(e, {
            hospital: cod,
            origem: 'eletiva',
            paciente: 990_000_045,
            atendimento: null,
            cabecalho: null,
            internacao: null,
            cirurgia: null,
            prioridade: 'eletivo',
            prazoMin: 2880,
            perfil: { intensiva: false, precaucao: null, tiposAcomodacao: [] },
            clinica: 'M',
            especialidade: null,
            cid: null,
            justificativa: 'Indicacao SINTETICA M44 em transito',
            situacaoLegado: 7,
            vinculo: 1,
            usuario: 'SGH.TESTE.NIR',
          });
          const reserva = await registrarReservaSgh(e, {
            hospital: cod,
            solicitacao,
            leito: { bloco: 'ZZ', acomodacao: 'M44', leito: '8' },
            validadeMin: 15,
            excecao: null,
            usuario: 'SGH.TESTE.NIR',
          });
          for (const [acao, de, para] of [
            ['reservar', 'solicitado', 'reservado'],
            ['transito', 'reservado', 'em_transito'],
          ] as const)
            await transicionarSolicitacaoSgh(e, {
              hospital: cod,
              solicitacao,
              acao,
              de,
              para,
              reserva,
              usuario: 'SGH.TESTE.NIR',
            });
          const vencida = (await reservasVencidasNir(e, cod, '2099-01-01T00:00:00')).find(
            (x) => x.id === reserva,
          );
          expect(vencida).toBeDefined();
          Object.assign(lida, vencida);
          const r = await fn(e0);
          estado = (await solicitacaoNir(e, cod, solicitacao))?.estado;
          return r;
        })) as unknown as NucleoNir['gravarSgh'],
    };
    const expirou = await expirarReserva(desfazendo, cod, lida, '2099-01-01T00:00:00');
    console.log(`[${cod}] expiração em trânsito: ${JSON.stringify({ expirou, estado })}`);
    expect(expirou).toBe(true);
    expect(estado).toBe('em_analise');
    expect(await nucleo.lerSomente(ctx, (l) => solicitacaoNir(l, cod, solicitacao))).toBeNull();
  });
});
