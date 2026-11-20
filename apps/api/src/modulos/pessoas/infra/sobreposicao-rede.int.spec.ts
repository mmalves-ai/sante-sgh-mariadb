// Regra 7 do M52 sobre as DUAS cópias de dev (3351 e 3352) como dois estabelecimentos da Rede (o `pc` e o sintético
// `sx`, que só existe neste processo; ver rede/infra/duas-copias.spec-util.ts): a mesma pessoa (o mesmo HMAC de CPF
// sintético) tem vínculo nos dois; o plantão no `sx` impede o plantão na mesma hora no `pc`, com a recusa que não diz
// a escala, o setor nem o vínculo do outro estabelecimento; fora do horário, entra. A consulta ao outro banco é só
// leitura e devolve só início e fim. Cada banco na sua transação DESFEITA; nenhuma cruza os bancos.
import {
  type ChaveGravada,
  type Executor,
  incluirVinculoPesSgh,
  plantoesNaRedePorCpfPesSgh,
  type PrerequisitoGravado,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import { fonteConfiguracaoMemoria } from '../../config/public-api.js';
import {
  type AmbienteDuasCopias,
  ambienteDuasCopias,
  DUAS_COPIAS,
  emDuasTransacoesDesfeitas,
  SEGUNDO,
} from '../../rede/infra/duas-copias.spec-util.js';
import { portaEscalaNasTransacoes } from '../escala/porta-escala-legado.js';
import { ServicoEscala } from '../escala/servico-escala.js';
import type { PortaPessoas } from '../porta.js';
import { portaPessoasNaTransacao } from '../porta-legado.js';

const chave = (c: string): ChaveGravada => ({
  id: c,
  tipo: 'recurso',
  chave: c,
  escopo: 'hospital',
  valor: '*',
  ligada: true,
  ligadaAntes: null,
  lote: null,
  justificativa: 'integração sintética',
  alteradoPor: 'SGH.TESTE',
  alteradoEm: '2026-10-25T10:00:00',
});
const cumprido: PrerequisitoGravado = {
  recurso: 'pessoas.escala',
  tipo: 'aprovacao',
  situacao: 'cumprido',
  validade: null,
  evidencia: 'integração sintética',
  alteradoPor: 'SGH.TESTE',
  alteradoEm: '2026-10-25T10:00:00',
};
const n = (v: unknown) => Number(v ?? 0);
const p2 = (x: number) => String(x).padStart(2, '0');
const HMAC = 'b'.repeat(64); // HMAC de mentira: a mesma "pessoa" sintética nos dois estabelecimentos

describe.skipIf(!DUAS_COPIAS)('sobreposição na Rede (duas cópias, transações desfeitas)', () => {
  let a: AmbienteDuasCopias;
  beforeAll(async () => {
    a = await ambienteDuasCopias();
  }, 900_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('plantão no outro estabelecimento na mesma hora é recusado sem expor a escala alheia; fora dela, entra', async () => {
    const r = await emDuasTransacoesDesfeitas(a, async (T) => {
      // A porta de pessoas de cada estabelecimento sobre a transação dele (a escala não usa o executor).
      const sem = {} as Executor;
      const porH = new Map([...T].map(([h, e]) => [h, portaPessoasNaTransacao(e, sem)]));
      const pessoas = new Proxy({} as PortaPessoas, {
        get: (_t, m: string) =>
          m === 'destino'
            ? 'legado'
            : (c: { hospital: string }, ...x: unknown[]) =>
                (porH.get(c.hospital) as unknown as Record<string, (...y: unknown[]) => unknown>)[m]!(
                  c,
                  ...x,
                ),
      });
      const trilha = new RegistradorTrilhaMemoria();
      const servico = new ServicoEscala(
        portaEscalaNasTransacoes(T),
        pessoas,
        trilha,
        fonteConfiguracaoMemoria(trilha, {
          chavesIniciais: () => [chave('pessoas.escala')],
          prerequisitosIniciais: () => [cumprido],
        }),
        null,
      );
      let k = 0;
      const s = (hospital: string): SessaoCadastro => ({
        req: {
          headers: { 'idempotency-key': `int-m52-rede-${Date.now().toString(36)}-${++k}` },
          ip: '127.0.0.1',
          sgh: { sessao: { unidadeAtiva: null } },
        } as never,
        hospital,
        rede: a.rede,
        login: 'SGH.TESTE',
        porta: { rede: a.rede, hospital },
        pode: () => true,
      });
      const vinculos = new Map<string, number>();
      for (const [h, e] of T) {
        const [cc] = await e.consultar(
          "SELECT FIRST 1 COD FROM TBCENCUS WHERE COALESCE(SITUACAO, 'A') <> 'I' ORDER BY COD",
          [],
          { teto: 1 },
        );
        const [un] = await e.consultar('SELECT FIRST 1 COD FROM TBUNIDAD WHERE COD > 0 ORDER BY COD', [], {
          teto: 1,
        });
        const v = await incluirVinculoPesSgh(e, {
          hospital: h,
          pessoa: null,
          cpfHmac: HMAC,
          cpfCifrado: 'v1.sintetico',
          nome: 'PLANTONISTA SINTETICO REDE',
          profissional: null,
          usuario: null,
          tipo: 'pj',
          matricula: null,
          cargo: 'Maqueiro',
          funcao: null,
          cargaSemanal: 30,
          centroCusto: n(cc?.['COD']),
          unidade: n(un?.['COD']),
          setor: null,
          admissao: '2026-01-01',
          por: 'SGH.TESTE',
        });
        vinculos.set(h, v.id);
        vinculos.set(`${h}:unidade`, n(un?.['COD']));
      }
      const hoje = await pessoas.hoje({ rede: a.rede, hospital: 'pc' });
      const [ano, mes] = hoje.split('-').map(Number) as [number, number];
      const comp = mes === 12 ? `${ano + 1}-01` : `${ano}-${p2(mes + 1)}`;
      const escala = async (h: string, setor: string) =>
        (
          await servico.criarEscala(s(h), {
            unidade: vinculos.get(`${h}:unidade`)!,
            setor,
            competencia: comp,
            tipo: 'apoio',
            cobertura: { manha: 0, tarde: 0, noite: 0 },
          })
        ).id;
      const pl = (esc: number, v: number, ini: string, fim: string) => ({
        escala: esc,
        vinculo: v,
        tipo: 'presencial' as const,
        inicio: ini,
        fim,
        chegadaMin: null,
        motivo: null,
      });
      const escSx = await escala(SEGUNDO, 'SETOR SINTETICO SECRETO');
      await servico.incluirPlantao(
        s(SEGUNDO),
        pl(escSx, vinculos.get(SEGUNDO)!, `${comp}-10T19:00`, `${comp}-11T07:00`),
      );
      const escPc = await escala('pc', 'SINT M52.2 REDE');
      const recusa = await servico
        .incluirPlantao(s('pc'), pl(escPc, vinculos.get('pc')!, `${comp}-11T01:00`, `${comp}-11T07:00`))
        .then(
          () => null,
          (x: unknown) => x as ErroProblema,
        );
      const fora = await servico.incluirPlantao(
        s('pc'),
        pl(escPc, vinculos.get('pc')!, `${comp}-12T07:00`, `${comp}-12T19:00`),
      );
      // O que a consulta ao outro banco devolve: só início e fim.
      const lidos = await plantoesNaRedePorCpfPesSgh(T.get(SEGUNDO)!, SEGUNDO, HMAC, {
        de: `${comp}-10T00:00`,
        ate: `${comp}-12T00:00`,
        inicioDesde: `${comp}-09T00:00`,
      });
      return {
        recusa: recusa?.extras['codigo'] ?? null,
        detalhe: recusa?.detalhe ?? '',
        fora: fora.alertas,
        lidos,
        comp,
      };
    });
    console.log(JSON.stringify({ recusa: r.recusa, fora: r.fora, lidos: r.lidos.length }));
    expect(r.recusa).toBe('sobreposicao-rede');
    expect(r.detalhe).toBe('O colaborador já tem plantão neste horário em outro estabelecimento da Rede.');
    expect(r.detalhe).not.toContain('SECRETO');
    expect(r.fora).toEqual([]);
    expect(r.lidos).toEqual([{ inicio: `${r.comp}-10T19:00`, fim: `${r.comp}-11T07:00` }]);
    expect(Object.keys(r.lidos[0]!)).toEqual(['inicio', 'fim']);
  });
});
