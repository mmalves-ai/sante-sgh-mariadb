// Interface com a folha externa (M53.1, fatia F0; ficha do M53, seções 4 a 6, regras 3 a 6) sobre a cópia (transação
// DESFEITA): um colaborador sintético (CLT) com o período de setembro fechado (gravado direto nas tabelas SGH_, como o
// passado), o afastamento registrado, o lote gerado com a conta, o arquivo recriado com o mesmo SHA-256, o retorno
// conferido com o resumo gravado e o retorno divergente que barra os títulos. As contagens das tabelas do outro sistema
// que a folha poderia tocar (remessas, funcionários, cabeçalho da folha, pendências do eSocial, contas a pagar) ficam
// iguais antes e depois. Só IDs, contagens e somas em memória; o CPF é sintético.
import { createHash, randomBytes } from 'node:crypto';
import { esquemaLoteExportacaoFolha, type LoteRetornoFolha } from '@sgh/contratos';
import {
  type ChaveGravada,
  incluirEventoPeriodoPesSgh,
  incluirVinculoPesSgh,
  type PrerequisitoGravado,
  somenteSgh,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { type AmbienteM27, ambienteM27, PODE_ESCREVER } from '../../acesso/aplicacao/copia.spec-util.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import { fonteConfiguracaoMemoria } from '../../config/public-api.js';
import { CifraCpf } from '../cifra-cpf.js';
import { portaRealizadoNaTransacao } from '../escala/porta-realizado-legado.js';
import { portaFolhaNaTransacao } from '../folha/porta-folha-legado.js';
import { ServicoFolha } from '../folha/servico-folha.js';
import { portaPontoNaTransacao } from '../ponto/porta-ponto-legado.js';
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
  alteradoEm: '2026-10-26T10:00:00',
});
const cumprido = (recurso: string): PrerequisitoGravado => ({
  recurso,
  tipo: 'aprovacao',
  situacao: 'cumprido',
  validade: null,
  evidencia: 'integração sintética',
  alteradoPor: 'SGH.TESTE',
  alteradoEm: '2026-10-26T10:00:00',
});
const n = (v: unknown) => Number(v ?? 0);
const LEGADAS = ['FPREMESSA', 'FPFUNC', 'FPCABECFOLHA', 'FPESOCPEND', 'MFCONPAG'] as const;
/** CPF sintético com dígitos válidos (não é de pessoa real). */
const CPF = '52998224725';
const COMP = '2026-09';

describe.skipIf(!PODE_ESCREVER)('interface com a folha externa (cópia, transação desfeita)', () => {
  let a: AmbienteM27;
  beforeAll(async () => {
    a = await ambienteM27();
  }, 900_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('afastamento → lote → arquivo → retorno conferido → divergente; tabelas do outro sistema intactas', async () => {
    const r = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-m531-folha' }, async (e) => {
      const contar = async () => {
        const out: Record<string, number> = {};
        for (const t of LEGADAS)
          out[t] = n((await e.consultar(`SELECT COUNT(*) Q FROM ${t}`, [], { teto: 1 }))[0]?.['Q']);
        return out;
      };
      const antes = await contar();
      const [cc] = await e.consultar(
        "SELECT FIRST 1 COD FROM TBCENCUS WHERE COALESCE(SITUACAO, 'A') <> 'I' ORDER BY COD",
        [],
        { teto: 1 },
      );
      const h = a.c.hospital;
      const s0 = somenteSgh(e);
      const cifra = new CifraCpf(randomBytes(32));
      const sufixo = Date.now().toString(36);
      const v = await incluirVinculoPesSgh(s0, {
        hospital: h,
        pessoa: null,
        cpfHmac: cifra.hmac(CPF),
        cpfCifrado: cifra.cifrar(CPF),
        nome: 'COLABORADOR SINTETICO M53.1',
        profissional: null,
        usuario: null,
        tipo: 'clt',
        matricula: `SF531-${sufixo}`,
        cargo: 'Auxiliar administrativo',
        funcao: null,
        cargaSemanal: 44,
        centroCusto: n(cc?.['COD']),
        unidade: null,
        setor: null,
        admissao: '2026-01-01',
        por: 'SGH.TESTE',
      });
      // Isola a massa sem escrever fora do executor: a leitura real dos vínculos da folha roda na cópia (SQL de
      // verdade), e a porta do teste deixa passar só o vínculo deste teste. Vínculos deixados na cópia por outros ramos
      // (com o CPF cifrado por outra chave) não barram mais o lote, e o caminho completo (lote, arquivo, retorno,
      // resumo, divergente) é sempre provado.
      const real = portaFolhaNaTransacao(e);
      let alheios = 0;
      const portaFolha = new Proxy(real, {
        get(alvo, prop) {
          if (prop !== 'vinculosDaFolha') {
            const x: unknown = Reflect.get(alvo, prop);
            return typeof x === 'function' ? (x as (...a: unknown[]) => unknown).bind(alvo) : x;
          }
          return async (...args: Parameters<typeof real.vinculosDaFolha>) => {
            const xs = await alvo.vinculosDaFolha(...args);
            alheios = Math.max(alheios, xs.filter((x) => x.id !== v.id).length);
            return xs.filter((x) => x.id === v.id);
          };
        },
      });
      const ctx = { rede: a.c.rede, hospital: h };
      const empresa = (await portaFolha.empresas(ctx))[0]!.codigo;
      const todos = await portaFolha.vinculosDaFolha(ctx, `${COMP}-01`, `${COMP}-30`);
      expect(todos.map((x) => x.id)).toEqual([v.id]);
      for (const x of todos)
        await incluirEventoPeriodoPesSgh(s0, {
          hospital: h,
          vinculo: x.id,
          competencia: COMP,
          acao: 'fechado',
          ref: null,
          hash: 'a'.repeat(64),
          totais: JSON.stringify({ classes: { '1': 9_600 }, eventos: { '1': 9_600 } }),
          concorda: null,
          texto: null,
          por: 'SGH.TESTE',
        });

      const trilha = new RegistradorTrilhaMemoria();
      const recursos = ['pessoas.colaborador', 'pessoas.folhaExterna'];
      const servico = new ServicoFolha(
        portaFolha,
        portaPessoasNaTransacao(e, a.executor),
        portaPontoNaTransacao(e),
        portaRealizadoNaTransacao(e, a.executor),
        trilha,
        fonteConfiguracaoMemoria(trilha, {
          chavesIniciais: () => recursos.map(chave),
          prerequisitosIniciais: () => recursos.map(cumprido),
        }),
        null,
        cifra,
      );
      const s: SessaoCadastro = {
        req: {
          headers: { 'idempotency-key': 'int-m531-1' },
          ip: '127.0.0.1',
          sgh: { sessao: { unidadeAtiva: null } },
        } as never,
        hospital: h,
        rede: a.c.rede,
        login: 'SGH.TESTE',
        porta: ctx,
        pode: () => true,
      };

      const apoio = await servico.apoioTela(s);
      const af = await servico.registrarAfastamento(s, {
        vinculo: v.id,
        motivo: apoio.motivosAfastamento[0]!.codigo,
        inicio: '2026-09-05',
        fim: '2026-09-09',
        observacao: null,
      });
      const g = await servico.gerarExportacao(s, { empresa, competencia: COMP });
      // Sem caminho parcial: com a massa isolada, o lote TEM de sair.
      expect(g.pendencias).toEqual([]);
      expect(g.gerado).toBe(true);
      const lote = g.lote!.id;
      const arq = await servico.arquivoLote(s, lote);
      expect(createHash('sha256').update(arq.conteudo, 'utf8').digest('hex')).toBe(g.lote!.resumo);
      const exportado = esquemaLoteExportacaoFolha.parse(JSON.parse(arq.conteudo));
      const nosso = exportado.colaboradores.find((c) => c.vinculo === v.id)!;
      expect(nosso.cpf).toBe(CPF);
      expect(exportado.afastamentos.filter((x) => x.vinculo === v.id)).toHaveLength(1);
      expect(exportado.eventosPonto).toEqual([{ vinculo: v.id, evento: 1, minutos: 9_600 }]);
      expect(exportado.horasPonto).toEqual([{ vinculo: v.id, tipoHora: 1, minutos: 9_600 }]);

      const retorno: LoteRetornoFolha = {
        leiaute: '1.0',
        loteExportado: lote,
        empresa,
        competencia: COMP,
        recebido: exportado.totais,
        colaboradores: exportado.colaboradores.map((c) => ({
          vinculo: c.vinculo,
          matriculaExterna: `EXT-${c.vinculo}`,
          rubricas: [
            { codigo: '001', natureza: 'provento' as const, valor: 200_000 },
            { codigo: '901', natureza: 'desconto' as const, valor: 20_000 },
          ],
          liquido: 180_000,
        })),
        encargos: [{ tipo: 'fgts', valor: 16_000, vencimento: '2026-10-07', centroCusto: null }],
        vencimentoLiquido: '2026-10-05',
        totais: {
          colaboradores: exportado.colaboradores.length,
          proventos: 200_000 * exportado.colaboradores.length,
          descontos: 20_000 * exportado.colaboradores.length,
          liquido: 180_000 * exportado.colaboradores.length,
          encargos: 16_000,
        },
      };
      const ok = await servico.importarRetorno(s, lote, retorno);
      expect(ok.situacao).toBe('conferido');
      expect(ok.linhasResumo).toBe(exportado.colaboradores.length * 3 + 1);
      const [res] = await e.consultar(
        `SELECT COUNT(*) Q, SUM(VALOR_CENTAVOS) S FROM SGH_PES_FOLHA_RESUMO WHERE ID_INTERFACE = ? AND RUBRICA_RESUMO = 'liquido'`,
        [ok.lote.id],
        { teto: 1 },
      );
      expect(n(res?.['S'])).toBe(retorno.totais.liquido);

      const div = await servico.importarRetorno(s, lote, {
        ...retorno,
        totais: { ...retorno.totais, liquido: retorno.totais.liquido + 1 },
      });
      expect(div.situacao).toBe('divergente');
      expect(div.podeLancar).toBe(false);
      expect(JSON.stringify(trilha)).not.toContain(CPF);
      return {
        antes,
        depois: await contar(),
        alheios,
        af: af.id,
        resumo: n(res?.['Q']),
      };
    });
    expect(r.depois).toEqual(r.antes);
    expect(r.af).toBeGreaterThan(0);
    expect(r.resumo).toBeGreaterThan(0);
  }, 900_000);
});
